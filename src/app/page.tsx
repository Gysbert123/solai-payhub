"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useState, useEffect, useMemo } from "react";
import bs58 from "bs58";
import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { sendTelegramSignal, sendTradeSuccess } from "@/lib/telegram";

interface Insight {
  id: string;
  meme: string;
  score: number;
  arb: string;
  risk: "Low" | "Medium" | "High";
  time: string;
  cost: number;
}

interface Arb {
  id: string;
  name: string;
  from: string;
  to: string;
  profit: number;
  risk: "Low" | "Medium" | "High";
  ai_score: number;
  updated: string;
}

export default function Home() {
  const network = "devnet";
  const endpoint = useMemo(() => clusterApiUrl(network), []);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function AppContent() {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [status, setStatus] = useState<"idle" | "paying" | "paid">("idle");
  const [insights, setInsights] = useState<Insight[]>([]);
  const [arbs, setArbs] = useState<Arb[]>([]);
  const [loading, setLoading] = useState(false);

  const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
  const SESSION_DURATION = 30 * 60 * 1000;

  const isPaid = () => {
    if (!publicKey) return false;
    const paidData = localStorage.getItem(`paid_${publicKey.toBase58()}`);
    if (!paidData) return false;
    const { timestamp } = JSON.parse(paidData);
    return Date.now() - timestamp < SESSION_DURATION;
  };

  const handlePay = async () => {
    if (!publicKey || !signTransaction || !PROJECT_WALLET) return;
    setStatus("paying");

    try {
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(PROJECT_WALLET),
          lamports: 0.001 * LAMPORTS_PER_SOL,
        })
      );

      const signedTx = await signTransaction(tx);
      const serializedTx = signedTx.serialize();

      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
      const sigStr = typeof signature === "string" ? signature : bs58.encode(signature);

      await connection.confirmTransaction(sigStr, "confirmed");

      localStorage.setItem(
        `paid_${publicKey.toBase58()}`,
        JSON.stringify({ timestamp: Date.now(), txid: sigStr })
      );
      setStatus("paid");
      alert(`Paid 0.001 SOL! Tx: ${sigStr}`);
    } catch (err: any) {
      alert("Payment failed: " + err.message);
      setStatus("idle");
    }
  };

  const getAIInsight = async () => {
    const address = publicKey?.toBase58();
    if (!address || !PROJECT_WALLET) return;

    try {
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new Transaction({
        recentBlockhash: blockhash,
        feePayer: publicKey!,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey!,
          toPubkey: new PublicKey(PROJECT_WALLET),
          lamports: 100000,
        })
      );

      const signed = await signTransaction!(tx);
      const serializedTx = signed.serialize();

      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 3,
      });

      const sigStr = typeof signature === "string" ? signature : bs58.encode(signature);
      console.log("AI Payment Tx:", sigStr);

      await connection.confirmTransaction(sigStr, "confirmed");

      let txData;
      for (let i = 0; i < 5; i++) {
        txData = await connection.getTransaction(sigStr, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (txData) break;
        await new Promise(r => setTimeout(r, 1500));
      }

      if (!txData) throw new Error("Tx not found after retry");

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signature: sigStr }),
      });

      const data = await res.json();
      console.log("AI API Response:", data);

      if (!res.ok || data.error) {
        alert("Payment failed: " + (data.error || "Try again"));
        return;
      }

      const insight: Insight = {
        id: Date.now().toString(),
        meme: data.meme,
        score: data.score,
        arb: data.arb,
        risk: data.risk,
        time: new Date().toLocaleTimeString(),
        cost: 0.0001,
      };

      setInsights(prev => [insight, ...prev].slice(0, 10));

      await sendTelegramSignal({
        meme: data.meme,
        score: data.score,
        arb: data.arb,
        risk: data.risk
      });
    } catch (err: any) {
      console.error("AI call error:", err);
      alert("AI call failed: " + err.message);
    }
  };

  const executeArb = async (arb: Arb) => {
    if (!publicKey || !signTransaction || !PROJECT_WALLET) return;

    try {
      const quoteRes = await fetch(
        `/api/jupiter/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${arb.id}&amount=100000000&slippageBps=100`
      );
      const quote = await quoteRes.json();

      if (!quote?.outAmount) throw new Error("No route found");

      const swapRes = await fetch("/api/jupiter/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          feeAccount: PROJECT_WALLET,
        }),
      });
      const swapData = await swapRes.json();

      if (!swapData.swapTransaction) throw new Error("Swap failed");

      const swapTx = Transaction.from(Buffer.from(swapData.swapTransaction, "base64"));
      const signedSwap = await signTransaction!(swapTx);
      const serializedTx = signedSwap.serialize();
      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
      const sigStr = typeof signature === "string" ? signature : bs58.encode(signature);

      await connection.confirmTransaction(sigStr, "confirmed");

      alert(`AUTO-TRADE SUCCESS!\nBought ${arb.name}\nTx: ${sigStr}\nYou earned 0.5% fee!`);

      await sendTradeSuccess(arb, sigStr);
    } catch (err: any) {
      console.error("Auto-trade error:", err);
      alert("Auto-trade failed: " + (err.message || "Try again"));
    }
  };

  const fetchArbs = async () => {
    if (!isPaid()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/scanner");
      const data = await res.json();
      setArbs(data.arbs || []);
    } catch (err) {
      console.error("Scanner error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isPaid()) {
      fetchArbs();
      const interval = setInterval(fetchArbs, 5000);
      return () => clearInterval(interval);
    }
  }, [status]);

  useEffect(() => {
    if (connected && isPaid()) setStatus("paid");
  }, [connected, publicKey]);

  return (
    <main className="flex min-h-screen flex-col items-center p-6 bg-gradient-to-br from-purple-900 to-black text-white">
      <h1 className="text-5xl font-bold mb-4">SolAI PayHub</h1>
      <p className="mb-8 text-center max-w-2xl">Pay once. Get AI insights, live arbs, and auto-trade.</p>

      {typeof window !== "undefined" && (
        <div className="flex justify-center mt-8">
          <WalletMultiButton
            style={{
              background: "linear-gradient(to right, #a855f7, #ec4899)",
              borderRadius: "9999px",
              padding: "12px 32px",
              fontWeight: "bold",
              fontSize: "16px",
              boxShadow: "0 10px 20px rgba(168, 85, 247, 0.3)",
            }}
            className="hover:scale-105"
          />
        </div>
      )}

      {connected && !isPaid() && status === "idle" && (
        <button
          onClick={handlePay}
          className="mt-8 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-8 py-4 rounded-full text-lg font-bold shadow-lg transition transform hover:scale-105"
        >
          Pay 0.001 SOL to Unlock AI + Dashboard
        </button>
      )}

      {status === "paying" && <p className="mt-8 text-yellow-300 animate-pulse">Unlocking...</p>}

      {isPaid() && (
        <div className="mt-8 w-full max-w-4xl space-y-8">
          <div className="bg-white/5 backdrop-blur rounded-xl p-6 border border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-cyan-400">AI INSIGHT HISTORY</h2>
              <button
                onClick={getAIInsight}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white px-4 py-2 rounded-full text-sm font-bold"
              >
                New Insight (0.0001 SOL)
              </button>
            </div>
            {insights.length === 0 ? (
              <p className="text-gray-400 text-center">No insights yet. Click above to get one.</p>
            ) : (
              <div className="space-y-3">
                {insights.map((i) => (
                  <div key={i.id} className="bg-white/10 rounded-lg p-3">
                    <p className="font-bold">{i.meme} — Score: {i.score}/100</p>
                    <p className="text-sm">{i.arb}</p>
                    <p className="text-xs text-gray-400">Risk: {i.risk} • {i.time} • Cost: {i.cost} SOL</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-2xl font-bold text-green-400 mb-4">LIVE ARB OPPORTUNITIES</h2>
            {loading && <p className="text-yellow-300">Scanning...</p>}

            <div className="space-y-3">
              {arbs.length === 0 && !loading && <p className="text-gray-400">No arbs found. Checking every 5s...</p>}

              {arbs.map((arb) => (
                <div
                  key={arb.id}
                  className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20 hover:border-purple-500 transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-bold text-lg">{arb.name}</p>
                      <p className="text-sm text-gray-300">
                        {arb.from} to {arb.to} = <span className="text-green-400">+{arb.profit.toFixed(2)}%</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold">AI: {arb.ai_score}/100</p>
                      <p className={`text-sm ${arb.risk === "Low" ? "text-green-400" : arb.risk === "Medium" ? "text-yellow-400" : "text-red-400"}`}>
                        Risk: {arb.risk}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => executeArb(arb)}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-1 rounded-full text-xs font-bold"
                    >
                      AUTO-TRADE
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Updated: {new Date(arb.updated).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>

            <p className="text-center text-sm text-gray-400 mt-6">
              Updates every 5 seconds • You earn 0.5% fee on every trade
            </p>
          </div>
        </div>
      )}
    </main>
  );
}