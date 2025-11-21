import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';

const PRIMARY_RPC = process.env.SOLANA_RPC_URL;
const FALLBACK_RPCS = [
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://api.mainnet-beta.solana.com',
];

async function sendRawTransactionWithFallback(serializedTx: Buffer): Promise<string> {
  const rpcs = PRIMARY_RPC ? [PRIMARY_RPC, ...FALLBACK_RPCS] : FALLBACK_RPCS;

  for (const rpcUrl of rpcs) {
    try {
      const connection = new Connection(rpcUrl, 'confirmed');
      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
      console.log(`[Send TX] Success using ${rpcUrl}`);
      return signature;
    } catch (error: any) {
      console.warn(`[Send TX] Failed on ${rpcUrl}:`, error.message);
      if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
        continue; // Try next RPC
      }
      throw error; // Last RPC, throw error
    }
  }

  throw new Error('All RPC endpoints failed');
}

export async function POST(req: NextRequest) {
  try {
    const { transaction } = await req.json();
    
    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid transaction data' },
        { status: 400 }
      );
    }

    // Convert base64 transaction to buffer
    const txBuffer = Buffer.from(transaction, 'base64');

    // Send raw transaction via RPC fallback
    const signature = await sendRawTransactionWithFallback(txBuffer);

    return NextResponse.json({ signature });
  } catch (error: any) {
    console.error('Send transaction error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to send transaction', 
        message: String(error?.message || error) 
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';

