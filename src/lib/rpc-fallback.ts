/**
 * Multi-RPC fallback system to handle rate limits gracefully
 * Tries primary RPC first, then falls back to free public RPCs
 */

const PRIMARY_RPC = process.env.SOLANA_RPC_URL;
const FALLBACK_RPCS = [
  'https://rpc.ankr.com/solana', // High free limit, no signup
  'https://solana-mainnet.g.alchemy.com/v2/demo', // Alchemy demo (high limit)
  'https://api.mainnet-beta.solana.com', // Public Solana RPC (lowest priority)
];

export interface RPCResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Try RPC request with fallback endpoints
 */
export async function fetchWithFallback(
  method: string,
  params: any[],
  options?: { timeout?: number }
): Promise<RPCResponse> {
  const rpcs = PRIMARY_RPC ? [PRIMARY_RPC, ...FALLBACK_RPCS] : FALLBACK_RPCS;
  const timeout = options?.timeout ?? 10000;

  let lastError: any = null;

  for (const rpcUrl of rpcs) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      let data: RPCResponse;

      try {
        data = JSON.parse(text);
      } catch (err) {
        console.warn(`[RPC Fallback] Failed to parse response from ${rpcUrl}:`, text);
        continue; // Try next RPC
      }

      // If rate limited (429), try next RPC
      if (response.status === 429 || (data.error && data.error.code === -32429)) {
        console.warn(`[RPC Fallback] Rate limited on ${rpcUrl}, trying next...`);
        continue;
      }

      // If error but not rate limit, try next RPC if available
      if (data.error && response.status !== 429) {
        lastError = new Error(`RPC error: ${data.error.message} (code: ${data.error.code})`);
        if (rpcs.indexOf(rpcUrl) < rpcs.length - 1) {
          console.warn(`[RPC Fallback] Error on ${rpcUrl}: ${data.error.message}, trying next...`);
          continue;
        }
        return data; // Last RPC, return error
      }

      // Success!
      if (data.result) {
        console.log(`[RPC Fallback] Success using ${rpcUrl}`);
        return data;
      }
    } catch (error: any) {
      // Network error or timeout - try next RPC
      lastError = error;
      if (error.name === 'AbortError') {
        console.warn(`[RPC Fallback] Timeout on ${rpcUrl}, trying next...`);
      } else {
        console.warn(`[RPC Fallback] Network error on ${rpcUrl}:`, error.message);
      }
      continue;
    }
  }

  // All RPCs failed
  throw new Error(
    `All RPC endpoints failed. Last error: ${lastError?.message || 'Unknown error'}. ` +
    `Consider upgrading your RPC plan or using a different provider.`
  );
}

