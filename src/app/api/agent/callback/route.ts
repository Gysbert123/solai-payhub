import { NextRequest, NextResponse } from 'next/server';
import {
  findReference,
  validateTransfer,
  FindReferenceError,
  ValidateTransferError,
} from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Connection, PublicKey } from '@solana/web3.js';
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

    await validateTransfer(connection, signature, {
      recipient: new PublicKey(PROJECT_WALLET),
      amount: PAYMENT_AMOUNT,
      reference: referenceKey,
    });

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

    if (err instanceof ValidateTransferError) {
      return NextResponse.json({ error: 'Payment details mismatch' }, { status: 422 });
    }

    console.error('Agent payment validation failed:', err);
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
}
