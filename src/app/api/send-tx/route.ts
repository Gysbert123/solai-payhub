import { NextRequest, NextResponse } from 'next/server';
import { Connection, SendTransactionError } from '@solana/web3.js';

const PRIMARY_RPC = process.env.SOLANA_RPC_URL;
const FALLBACK_RPCS = [
  'https://rpc.ankr.com/solana',
  'https://solana-mainnet.g.alchemy.com/v2/demo',
  'https://api.mainnet-beta.solana.com',
];

function buildRpcList(preferredRpc?: string | null) {
  const base = PRIMARY_RPC ? [PRIMARY_RPC, ...FALLBACK_RPCS] : [...FALLBACK_RPCS];
  if (!preferredRpc) return base;
  return [preferredRpc, ...base.filter((rpc) => rpc !== preferredRpc)];
}

async function sendRawTransactionWithFallback(serializedTx: Buffer, preferredRpc?: string | null): Promise<string> {
  const rpcs = buildRpcList(preferredRpc);
  let lastError: any = null;
  let lastErrorLogs: string[] = [];

  for (const rpcUrl of rpcs) {
    let connection: Connection | null = null;
    try {
      connection = new Connection(rpcUrl, 'confirmed');
      
      // Send the transaction with skipPreflight to avoid strict blockhash validation
      // The blockhash is already validated when we fetch it, and skipping preflight
      // avoids the RPC rejecting it due to timing differences
      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true, // Skip preflight to avoid blockhash expiration issues
        maxRetries: 3,
      });
      
      // Validate signature format
      if (!signature || typeof signature !== 'string' || signature.length < 32) {
        throw new Error(`Invalid signature received from ${rpcUrl}: ${signature}`);
      }
      
      console.log(`[Send TX] Signature received from ${rpcUrl}: ${signature}`);
      
      // Verify the transaction was actually broadcast by checking if it exists
      // Wait a moment for the transaction to propagate
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Try to get the transaction to verify it was actually broadcast
      let verified = false;
      for (let verifyAttempt = 0; verifyAttempt < 3; verifyAttempt++) {
        try {
          const tx = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          
          if (tx) {
            console.log(`[Send TX] Transaction verified on-chain using ${rpcUrl}`);
            verified = true;
            break;
          }
          
          // Try checking signature status as fallback
          const status = await connection.getSignatureStatus(signature);
          if (status.value) {
            console.log(`[Send TX] Transaction status found using ${rpcUrl}`);
            verified = true;
            break;
          }
        } catch (verifyErr: any) {
          console.warn(`[Send TX] Verify attempt ${verifyAttempt + 1} failed on ${rpcUrl}:`, verifyErr.message);
        }
        
        if (verifyAttempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      if (!verified) {
        // Transaction might still be pending, but we got a signature so it was likely sent
        // Log a warning but still return the signature - the confirmation endpoint will check it
        console.warn(`[Send TX] Could not immediately verify transaction ${signature} on ${rpcUrl}, but signature was returned. Transaction may still be processing.`);
      }
      
      return signature;
    } catch (error: any) {
      lastError = error;
      
      // Extract detailed logs if this is a SendTransactionError
      if (error instanceof SendTransactionError && connection) {
        try {
          // SendTransactionError has a getLogs() method that returns simulation logs
          if (typeof error.getLogs === 'function') {
            const logs = await error.getLogs(connection);
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
      
      // Check if it's a blockhash not found error
      const isBlockhashError = errorMessage.includes('Blockhash not found') || 
                               errorMessage.includes('blockhash not found') ||
                               errorMessage.includes('blockhash expired');
      
      if (isBlockhashError) {
        // Blockhash expired - this can happen if there's a delay between client fetch and server send
        // Try next RPC, but if all fail, suggest user retry (they'll get a fresh blockhash)
        if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
          console.warn(`[Send TX] Blockhash expired on ${rpcUrl}, trying next RPC...`);
          continue;
        }
        // All RPCs failed with blockhash error - suggest retry
        throw new Error(
          `Blockhash expired. Please try again - a fresh blockhash will be fetched automatically. ` +
          `This can happen if there's a delay between signing and sending the transaction.`
        );
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
    const { transaction, preferredRpc } = await req.json();
    
    if (!transaction || typeof transaction !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid transaction data' },
        { status: 400 }
      );
    }

    // Convert base64 transaction to buffer
    const txBuffer = Buffer.from(transaction, 'base64');

    // Send raw transaction via RPC fallback
    const signature = await sendRawTransactionWithFallback(txBuffer, preferredRpc);

    return NextResponse.json({ signature });
  } catch (error: any) {
    console.error('Send transaction error:', error);
    
    // Extract logs from SendTransactionError if available
    let logs: string[] = [];
    if (error instanceof SendTransactionError && typeof error.getLogs === 'function') {
      try {
        const errorLogs = await error.getLogs(new Connection(PRIMARY_RPC ?? FALLBACK_RPCS[0], 'confirmed'));
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

