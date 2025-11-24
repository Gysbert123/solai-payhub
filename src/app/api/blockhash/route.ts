import { NextResponse } from 'next/server';
import { fetchWithFallback } from '@/lib/rpc-fallback';

export async function GET() {
  try {
    const data = await fetchWithFallback('getLatestBlockhash', [
      {
        commitment: 'processed',
        minContextSlot: undefined,
      },
    ]);

    if (!data?.result?.value?.blockhash) {
      throw new Error('Invalid blockhash response: ' + JSON.stringify(data));
    }

    const blockhash = data.result.value.blockhash;
    const lastValidBlockHeight = data.result.value.lastValidBlockHeight;
    const rpc = data._endpoint ?? null;

    return NextResponse.json({
      blockhash,
      lastValidBlockHeight,
      rpc,
    });
  } catch (error: any) {
    console.error('Blockhash endpoint error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get blockhash', 
        message: String(error?.message || error),
        hint: 'All RPC endpoints are rate-limited. Consider upgrading your RPC plan or using a different provider.'
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
