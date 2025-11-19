import { NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';

const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

export async function GET() {
  try {
    const connection = new Connection(SOLANA_ENDPOINT, 'confirmed');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    
    return NextResponse.json({
      blockhash,
      lastValidBlockHeight,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to get blockhash', message: error.message },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';

