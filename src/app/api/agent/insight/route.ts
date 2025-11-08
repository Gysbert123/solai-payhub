import { NextRequest, NextResponse } from 'next/server';
import { encodeURL } from '@solana/pay';
import BigNumber from 'bignumber.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createAgentPayment } from '@/lib/db';

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const PAYMENT_AMOUNT = new BigNumber(0.0001);

export async function POST(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json(
      { error: 'Project wallet not configured' },
      { status: 500 }
    );
  }

  const { agentId } = await req.json().catch(() => ({ agentId: null }));
  const normalizedAgentId = typeof agentId === 'string' && agentId.trim().length > 0
    ? agentId.trim()
    : 'anonymous';

  const reference = Keypair.generate().publicKey.toBase58();

  const record = await createAgentPayment(
    normalizedAgentId,
    reference,
    PAYMENT_AMOUNT.toFixed()
  );

  if (!record) {
    return NextResponse.json(
      { error: 'Payment service unavailable' },
      { status: 503 }
    );
  }

  const paymentUrl = encodeURL({
    recipient: new PublicKey(PROJECT_WALLET),
    amount: PAYMENT_AMOUNT,
    reference: new PublicKey(reference),
    label: 'SolAI PayHub',
    message: 'AI Insight unlock (0.0001 SOL)',
    memo: record.id,
  }).toString();

  return NextResponse.json(
    {
      paymentId: record.id,
      reference,
      amount: PAYMENT_AMOUNT.toFixed(),
      recipient: PROJECT_WALLET,
      paymentUrl,
    },
    {
      status: 402,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
