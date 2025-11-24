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
      
      // Send the transaction with preflight enabled to catch invalid transactions
      // If preflight fails due to blockhash expiration, we'll try the next RPC
      let signature: string;
      try {
        signature = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: false, // Enable preflight to catch invalid transactions
          maxRetries: 3,
        });
      } catch (preflightError: any) {
        // Extract error details
        const errorMsg = preflightError?.message || String(preflightError);
        const errorLogs = preflightError instanceof SendTransactionError && connection
          ? await preflightError.getLogs(connection).catch(() => [])
          : [];
        
        // If preflight fails due to blockhash, try with skipPreflight (but log it)
        if (errorMsg.includes('Blockhash not found') || errorMsg.includes('blockhash')) {
          console.warn(`[Send TX] Preflight failed with blockhash error on ${rpcUrl}, retrying with skipPreflight...`);
          signature = await connection.sendRawTransaction(serializedTx, {
            skipPreflight: true,
            maxRetries: 3,
          });
        } else {
          // Preflight caught an invalid transaction - throw with details
          const logsMsg = errorLogs.length > 0 ? `\nSimulation logs: ${errorLogs.join('\n')}` : '';
          throw new Error(
            `Transaction failed preflight validation: ${errorMsg}${logsMsg}. ` +
            `This usually means insufficient funds, invalid instruction, or the transaction is malformed.`
          );
        }
      }
      
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
            // Check if transaction failed
            if (status.value.err) {
              throw new Error(
                `Transaction was rejected by the network: ${JSON.stringify(status.value.err)}. ` +
                `This usually means insufficient funds, invalid instruction, or the transaction was dropped.`
              );
            }
            console.log(`[Send TX] Transaction status found using ${rpcUrl} - status: ${status.value.confirmationStatus}`);
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
        // Transaction might still be pending, but if we can't verify it after multiple attempts,
        // there's likely an issue. Wait longer and check one more time.
        console.warn(`[Send TX] Could not immediately verify transaction ${signature} on ${rpcUrl} after 3 attempts. ` +
          `Waiting 5 more seconds for final check...`);
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          // Final check - if transaction still doesn't exist, it was likely dropped
          const finalCheck = await connection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          
          if (finalCheck) {
            // Check if transaction failed
            if (finalCheck.meta?.err) {
              throw new Error(
                `Transaction was rejected: ${JSON.stringify(finalCheck.meta.err)}. ` +
                `Check Solscan: https://solscan.io/tx/${signature}`
              );
            }
            console.log(`[Send TX] Transaction verified on final check!`);
            return signature;
          }
          
          // Also check signature status as fallback
          const finalStatus = await connection.getSignatureStatus(signature);
          if (finalStatus.value) {
            if (finalStatus.value.err) {
              throw new Error(
                `Transaction was rejected: ${JSON.stringify(finalStatus.value.err)}. ` +
                `Check Solscan: https://solscan.io/tx/${signature}`
              );
            }
            console.log(`[Send TX] Transaction status found - ${finalStatus.value.confirmationStatus}`);
            return signature;
          }
          
          // Transaction doesn't exist - it was likely dropped by the RPC
          // This can happen if the transaction is invalid (wrong blockhash, insufficient funds, etc.)
          throw new Error(
            `Transaction was not broadcast to the network. The RPC returned a signature (${signature}) ` +
            `but the transaction does not exist on-chain. This usually means: ` +
            `1) The blockhash expired before broadcast, 2) Insufficient funds, ` +
            `3) The transaction was invalid, or 4) The RPC dropped it silently. ` +
            `Please try again - a fresh blockhash will be fetched. ` +
            `Check Solscan: https://solscan.io/tx/${signature}`
          );
        } catch (finalErr: any) {
          // If it's our error about rejection or not broadcast, throw it
          if (finalErr.message?.includes('Transaction was rejected') || 
              finalErr.message?.includes('Transaction was not broadcast')) {
            throw finalErr;
          }
          // Otherwise, the transaction might still be processing
          console.warn(`[Send TX] Final verification check failed:`, finalErr);
          throw new Error(
            `Could not verify transaction was broadcast. Signature: ${signature}. ` +
            `The transaction may still be processing, but it's not visible on the network yet. ` +
            `Please check Solscan manually: https://solscan.io/tx/${signature}`
          );
        }
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
      
      // Check for API key / authentication errors
      const isAuthError = errorMessage.includes('API key') || 
                         errorMessage.includes('403') ||
                         errorMessage.includes('Forbidden') ||
                         errorMessage.includes('-32052');
      
      if (isAuthError) {
        console.warn(`[Send TX] RPC authentication failed on ${rpcUrl} - trying next RPC...`);
        if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
          continue;
        }
        // All RPCs failed with auth error
        throw new Error(
          `All RPC endpoints are rejecting requests (authentication/rate limit). ` +
          `Please check your SOLANA_RPC_URL environment variable in Vercel. ` +
          `If using a free/public RPC, you may need to upgrade to a paid plan or use a different provider.`
        );
      }
      
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

