import { NextResponse } from 'next/server';

const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

export async function GET() {
  try {
    const response = await fetch(SOLANA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [
          {
            commitment: 'finalized',
          },
        ],
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error('RPC request failed: ' + response.status + ' body=' + text);
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Failed to parse blockhash response: ' + err + ' body=' + text);
    }

    if (!data?.result?.value?.blockhash) {
      throw new Error('Invalid blockhash response: ' + JSON.stringify(data));
    }

    const blockhash = data.result.value.blockhash;
    const lastValidBlockHeight = data.result.value.lastValidBlockHeight;

    return NextResponse.json({
      blockhash,
      lastValidBlockHeight,
    });
  } catch (error: any) {
    console.error('Blockhash endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to get blockhash', message: String(error?.message || error) },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
