import { Connection } from '@solana/web3.js';
import { NextRequest, NextResponse } from 'next/server';

const connection = new Connection(
  process.env.SOLANA_RPC_URL!,
  'confirmed'
);

export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get('sig');
  if (!sig) {
    return NextResponse.json({ error: 'Missing sig' }, { status: 400 });
  }

  try {
    const status = await connection.getSignatureStatus(sig);

    // If confirmed/finalized → return success
    if (status.value && (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized')) {
      let detailedError = status.value.err;
      
      // If there's an error, fetch the transaction to get more details
      if (status.value.err) {
        try {
          const tx = await connection.getTransaction(sig, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          if (tx?.meta?.err) {
            detailedError = tx.meta.err;
          }
        } catch {
          // If we can't fetch details, use the status error
        }
      }
      
      return NextResponse.json({
        confirmed: true,
        finalized: status.value.confirmationStatus === 'finalized',
        err: detailedError,
      });
    }

    // Still processing → tell client to try again
    return NextResponse.json({ confirmed: false });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export const maxDuration = 30;

