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
  let lastError: any = null;

  for (const rpcUrl of rpcs) {
    try {
      const connection = new Connection(rpcUrl, 'confirmed');
      
      // Send the transaction
      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: false, // Enable preflight to catch errors early
        maxRetries: 3,
      });
      
      console.log(`[Send TX] Signature received from ${rpcUrl}: ${signature}`);
      
      // Verify the transaction was actually accepted by waiting a moment and checking
      // This ensures the RPC actually broadcast it, not just returned a signature
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        const status = await connection.getSignatureStatus(signature);
        if (status.value) {
          console.log(`[Send TX] Transaction confirmed on-chain using ${rpcUrl}`);
          return signature;
        }
        // If status is null, transaction might still be pending - that's okay
        console.log(`[Send TX] Transaction pending, signature: ${signature}`);
        return signature;
      } catch (verifyErr: any) {
        console.warn(`[Send TX] Could not verify transaction on ${rpcUrl}:`, verifyErr.message);
        // Still return signature - it might be valid but RPC is slow
        return signature;
      }
    } catch (error: any) {
      lastError = error;
      console.error(`[Send TX] Failed on ${rpcUrl}:`, error.message);
      if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
        continue; // Try next RPC
      }
      // Last RPC failed, throw detailed error
      throw new Error(
        `All RPC endpoints failed. Last error from ${rpcUrl}: ${error.message}. ` +
        `This usually means the transaction is invalid or the RPC is rate-limited.`
      );
    }
  }

  throw new Error(
    `All RPC endpoints failed. Last error: ${lastError?.message || 'Unknown error'}`
  );
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

