import { NextRequest, NextResponse } from 'next/server';
import { findReference, FindReferenceError } from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  confirmAgentPayment,
  getAgentPaymentByReference,
  markAgentInsightDelivered,
} from '@/lib/db';
import { sendTelegramSignal } from '@/lib/telegram';

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const PAYMENT_AMOUNT = new BigNumber(0.0001);
const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

type InsightPayload = {
  meme: string;
  score: number;
  arb: string;
  risk: 'Low' | 'Medium' | 'High';
};

function generateInsight(): InsightPayload {
  const memes = ['PUMPED', 'MOONSHOT', 'SOLAI', 'PHUB', 'ARBITOR', 'MOOON'];
  const arbs = [
    'Buy Raydium → Sell Jupiter',
    'Buy Orca → Sell Raydium',
    'Buy Jupiter → Sell Meteora',
    'SOL/USDC depth sweep',
  ];
  const risks: InsightPayload['risk'][] = ['Low', 'Medium', 'High'];

  return {
    meme: memes[Math.floor(Math.random() * memes.length)],
    score: Math.floor(Math.random() * 30) + 70,
    arb: arbs[Math.floor(Math.random() * arbs.length)],
    risk: risks[Math.floor(Math.random() * risks.length)],
  };
}

async function assertSystemTransfer(
  connection: Connection,
  signature: string,
  recipient: PublicKey,
  amount: BigNumber,
  reference: PublicKey
) {
  const tx = await connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta) {
    throw new Error('transaction not found');
  }

  const expectedLamports = amount.multipliedBy(1_000_000_000);

  const message = tx.transaction.message;
  const accountKeys: PublicKey[] = [];
  const instructions: {
    programId: PublicKey;
    keys: { pubkey: PublicKey }[];
  }[] = [];

  if ('instructions' in message) {
    // Legacy transaction
    message.accountKeys.forEach((key) => accountKeys.push(key));
    message.instructions.forEach((ix) => {
      const programId = message.accountKeys[ix.programIdIndex]!;
      const keys = ix.accounts.map((index) => ({
        pubkey: message.accountKeys[index]!,
      }));
      instructions.push({ programId, keys });
    });
  } else {
    // Versioned transaction (v0 and beyond)
    const accountKeysFromLookups = {
      writable:
        tx.meta.loadedAddresses?.writable.map((key) => new PublicKey(key)) ?? [],
      readonly:
        tx.meta.loadedAddresses?.readonly.map((key) => new PublicKey(key)) ?? [],
    };

    const lookupKeys = message.getAccountKeys(accountKeysFromLookups);
    for (let i = 0; i < lookupKeys.staticAccountKeys.length; i++) {
      accountKeys.push(lookupKeys.staticAccountKeys[i]);
    }
    for (const key of lookupKeys.accountKeysFromLookups ?? []) {
      accountKeys.push(key);
    }

    message.compiledInstructions.forEach((ix) => {
      const programId = accountKeys[ix.programIdIndex]!;
      const keys = ix.accountKeyIndexes.map((index) => ({
        pubkey: accountKeys[index]!,
      }));
      instructions.push({ programId, keys });
    });
  }

  const recipientIndex = accountKeys.findIndex((key) => key.equals(recipient));

  if (recipientIndex === -1) {
    throw new Error('recipient mismatch');
  }

  const transferIx = instructions.find(
    (ix) =>
      ix.programId.equals(SystemProgram.programId) &&
      ix.keys.length >= 2 &&
      ix.keys[1].pubkey.equals(recipient)
  );

  if (!transferIx) {
    throw new Error('system transfer not found');
  }

  const hasReference = transferIx.keys.some((key) => key.pubkey.equals(reference));
  if (!hasReference) {
    throw new Error('reference not found');
  }

  const postLamports = new BigNumber(tx.meta.postBalances[recipientIndex]);
  const preLamports = new BigNumber(tx.meta.preBalances[recipientIndex]);
  const deltaLamports = postLamports.minus(preLamports);

  if (deltaLamports.lt(expectedLamports)) {
    throw new Error('amount not transferred');
  }
}

export async function POST(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json({ error: 'Project wallet not configured' }, { status: 500 });
  }

  const { reference } = await req.json().catch(() => ({ reference: null }));
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
  }

  const existing = await getAgentPaymentByReference(reference);
  if (!existing) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (existing.status === 'delivered' || existing.status === 'confirmed') {
    const insight = existing.insight_json ? JSON.parse(existing.insight_json) : null;
    return NextResponse.json(
      {
        status: 'paid',
        signature: existing.tx_signature,
        insight,
      },
      { status: 200 }
    );
  }

  const connection = new Connection(SOLANA_ENDPOINT, 'confirmed');
  const referenceKey = new PublicKey(reference);

  try {
    const { signature } = await findReference(connection, referenceKey, {
      finality: 'confirmed',
    });

    const recipientKey = new PublicKey(PROJECT_WALLET);
    await assertSystemTransfer(connection, signature, recipientKey, PAYMENT_AMOUNT, referenceKey);

    const insight = generateInsight();

    const updated = await confirmAgentPayment(reference, signature, JSON.stringify(insight));
    if (!updated) {
      return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
    }

    await sendTelegramSignal(insight);
    await markAgentInsightDelivered(updated.id);

    return NextResponse.json(
      {
        status: 'paid',
        signature,
        insight,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err instanceof FindReferenceError) {
      return NextResponse.json({ status: 'pending' }, { status: 402 });
    }

    console.error('Agent payment validation failed:', err);
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
}