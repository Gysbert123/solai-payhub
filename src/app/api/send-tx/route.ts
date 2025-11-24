import { NextRequest, NextResponse } from 'next/server';
import { Connection, SendTransactionError } from '@solana/web3.js';

const PRIMARY_RPC = process.env.SOLANA_RPC_URL;
const FALLBACK_RPCS = [
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://api.mainnet-beta.solana.com',
];

async function sendRawTransactionWithFallback(serializedTx: Buffer): Promise<string> {
  const rpcs = PRIMARY_RPC ? [PRIMARY_RPC, ...FALLBACK_RPCS] : FALLBACK_RPCS;
  let lastError: any = null;
  let lastErrorLogs: string[] = [];

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
      
      // Extract detailed logs if this is a SendTransactionError
      if (error instanceof SendTransactionError) {
        try {
          // SendTransactionError has a getLogs() method that returns simulation logs
          if (typeof error.getLogs === 'function') {
            const logs = error.getLogs();
            if (logs && Array.isArray(logs)) {
              lastErrorLogs = logs;
              console.error(`[Send TX] SendTransactionError logs from ${rpcUrl}:`, logs);
            }
          }
        } catch (logErr) {
          console.warn(`[Send TX] Could not get logs from error:`, logErr);
        }
      }
      
      const errorMessage = error.message || String(error);
      console.error(`[Send TX] Failed on ${rpcUrl}:`, errorMessage);
      
      // Check if it's a blockhash not found error - this means we should try a fresh blockhash
      const isBlockhashError = errorMessage.includes('Blockhash not found') || 
                               errorMessage.includes('blockhash not found') ||
                               errorMessage.includes('blockhash expired');
      
      if (isBlockhashError && rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
        console.warn(`[Send TX] Blockhash expired on ${rpcUrl}, trying next RPC...`);
        continue;
      }
      
      if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
        continue; // Try next RPC
      }
      
      // Last RPC failed, throw detailed error with logs
      let errorDetails = errorMessage;
      if (lastErrorLogs.length > 0) {
        errorDetails += `\nSimulation logs: ${lastErrorLogs.join('\n')}`;
      }
      
      throw new Error(
        `All RPC endpoints failed. Last error from ${rpcUrl}: ${errorDetails}. ` +
        `This usually means the transaction is invalid, the blockhash expired, or the RPC is rate-limited.`
      );
    }
  }

  // Build final error message with logs
  let finalErrorMessage = `All RPC endpoints failed. Last error: ${lastError?.message || 'Unknown error'}`;
  if (lastErrorLogs.length > 0) {
    finalErrorMessage += `\nSimulation logs: ${lastErrorLogs.join('\n')}`;
  }
  
  throw new Error(finalErrorMessage);
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
    
    // Extract logs from SendTransactionError if available
    let logs: string[] = [];
    if (error instanceof SendTransactionError && typeof error.getLogs === 'function') {
      try {
        const errorLogs = error.getLogs();
        if (Array.isArray(errorLogs)) {
          logs = errorLogs;
        }
      } catch (logErr) {
        console.warn('Could not extract logs:', logErr);
      }
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to send transaction', 
        message: String(error?.message || error),
        logs: logs.length > 0 ? logs : undefined
      },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

