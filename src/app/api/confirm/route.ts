import { NextRequest, NextResponse } from 'next/server';
import { fetchWithFallback } from '@/lib/rpc-fallback';

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 800;

export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get('sig');
  if (!sig) {
    return NextResponse.json({ error: 'Missing sig' }, { status: 400 });
  }

  try {
    let signatureStatus: any | null = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
      const statusResponse = await fetchWithFallback('getSignatureStatuses', [[sig]]);
      const value = statusResponse?.result?.value?.[0];
      if (value) {
        signatureStatus = value;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    if (!signatureStatus) {
      return NextResponse.json({ confirmed: false, pending: true });
    }

    const confirmationStatus = signatureStatus.confirmationStatus;
    const isConfirmed = confirmationStatus === 'confirmed' || confirmationStatus === 'finalized';

    if (isConfirmed) {
      let detailedError = signatureStatus.err;
      
      if (signatureStatus.err) {
        try {
          const txResponse = await fetchWithFallback(
            'getTransaction',
            [
              sig,
              {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
              },
            ],
            { timeout: 15000 }
          );

          const tx = txResponse?.result;
          if (tx?.meta?.err) {
            detailedError = tx.meta.err;
          }
        } catch (err) {
          console.warn('[confirm] Failed to fetch transaction details:', err);
        }
      }
      
      return NextResponse.json({
        confirmed: true,
        finalized: confirmationStatus === 'finalized',
        err: detailedError,
      });
    }

    return NextResponse.json({ confirmed: false });
  } catch (e) {
    console.error('[confirm] Error checking signature status:', e);
    return NextResponse.json(
      {
        error: 'Failed to confirm transaction',
        message: String(e),
        hint: 'All RPC endpoints may be rate-limited. Please try again shortly.',
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 30;

