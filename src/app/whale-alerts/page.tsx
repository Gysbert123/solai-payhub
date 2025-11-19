"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import WhaleAlertsPaywall from "@/components/WhaleAlertsPaywall";

const WalletMultiButtonDynamic = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function resolveEndpoint(customUrl: string | undefined, fallback: string) {
  if (!customUrl) return fallback;
  if (customUrl.startsWith("http://") || customUrl.startsWith("https://")) {
    return customUrl;
  }
  if (typeof window !== "undefined" && customUrl.startsWith("/")) {
    return new URL(customUrl, window.location.origin).toString();
  }
  return fallback;
}

export default function WhaleAlertsPage() {
  const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";
  const fallbackEndpoint = useMemo(() => clusterApiUrl(network), [network]);
  const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  const endpoint = useMemo(() => resolveEndpoint(customRpc, fallbackEndpoint), [customRpc, fallbackEndpoint]);
  const wallets = useMemo(() => [], []);
  const connectionConfig = useMemo(
    () => ({
      commitment: "confirmed" as const,
      disableWs: true,
      confirmTransactionInitialTimeout: 30_000,
    }),
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div className="min-h-screen bg-slate-950 text-white">
            <div className="mx-auto max-w-5xl px-4 py-12">
              <div className="mb-10 space-y-3 text-center">
                <p className="text-sm uppercase tracking-wide text-cyan-300">Alpha Feed</p>
                <h1 className="text-4xl font-bold">Whale Alerts</h1>
                <p className="text-white/70">
                  Monitor every $1,000+ buy & sell on Solana mainnet in real time. Unlock the feed with SOL using your existing PayHub wallet
                  experience.
                </p>
              </div>
              <div className="flex justify-center mb-8">
                <WalletMultiButtonDynamic
                  style={{
                    background: "linear-gradient(to right, #06b6d4, #4f46e5)",
                    borderRadius: "9999px",
                    padding: "12px 32px",
                    fontWeight: "bold",
                    fontSize: "16px",
                    boxShadow: "0 10px 20px rgba(6, 182, 212, 0.3)",
                  }}
                  className="hover:scale-105"
                />
              </div>
              <WhaleAlertsPaywall />
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

