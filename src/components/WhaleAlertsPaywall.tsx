"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import bs58 from "bs58";
import { WhaleAlert } from "@/lib/whale";

type WhalePlanOption = {
  tier: string;
  label: string;
  amount: string;
  durationSeconds: number;
  reference: string;
  paymentUrl: string;
  phantomUrl: string;
};

type WhaleResponse =
  | {
      paid: boolean;
      alerts: WhaleAlert[];
      tier?: string;
      expiresInMs?: number;
    }
  | {
      feature: string;
      message: string;
      plans: WhalePlanOption[];
    };

const MIN_USD = Number(process.env.NEXT_PUBLIC_WHALE_ALERT_MIN_USD ?? "1000");
const DEFAULT_LIMIT = 25;
const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;

const blurClass = "blur-sm opacity-70 pointer-events-none select-none";

export default function WhaleAlertsPaywall() {
  const { publicKey, sendTransaction, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [previewAlerts, setPreviewAlerts] = useState<WhaleAlert[]>([]);
  const [alerts, setAlerts] = useState<WhaleAlert[]>([]);
  const [plans, setPlans] = useState<WhalePlanOption[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<WhalePlanOption | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [walletAccess, setWalletAccess] = useState<{ tier?: string; expiresInMs?: number } | null>(null);

  useEffect(() => {
    fetch(`/api/whale-alerts?preview=1&limit=5&min_usd=${MIN_USD}`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.alerts)) {
          setPreviewAlerts(data.alerts);
        }
      })
      .catch(() => {
        // ignore preview errors
      });
  }, []);

  const walletParam = useMemo(() => publicKey?.toBase58(), [publicKey]);

  const fetchAlerts = useCallback(
    async (opts?: { reference?: string }) => {
      if (!walletParam) {
        setError("Connect a wallet to unlock real-time whale alerts.");
        return;
      }

      setLoading(true);
      setError("");
      setStatus("Checking whale alerts access…");

      const params = new URLSearchParams({
        wallet: walletParam,
        min_usd: MIN_USD.toString(),
        limit: String(DEFAULT_LIMIT),
      });
      if (opts?.reference) {
        params.set("reference", opts.reference);
      }

      const res = await fetch(`/api/whale-alerts?${params.toString()}`);

      if (res.status === 200) {
        const data: WhaleResponse = await res.json();
        if ("alerts" in data) {
          setAlerts(data.alerts);
          setUnlocked(true);
          setPlans([]);
          setSelectedPlan(null);
          setWalletAccess({
            tier: data.tier,
            expiresInMs: data.expiresInMs,
          });
          setStatus("");
        }
      } else if (res.status === 402) {
        const data: WhaleResponse = await res.json();
        if ("plans" in data) {
          setPlans(data.plans);
          setStatus("Select a plan to unlock whale alerts.");
          setAlerts([]);
          setUnlocked(false);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Unable to load whale alerts.");
      }
      setLoading(false);
    },
    [walletParam]
  );

  useEffect(() => {
    if (walletParam) {
      fetchAlerts();
    }
  }, [walletParam, fetchAlerts]);

  useEffect(() => {
    if (!unlocked) return;
    const interval = setInterval(() => {
      fetchAlerts();
    }, 15_000);
    return () => clearInterval(interval);
  }, [unlocked, fetchAlerts]);

  const handleOpenPlan = (plan: WhalePlanOption) => {
    setSelectedPlan(plan);
    setStatus(`Complete the payment in your wallet (${plan.amount} SOL).`);
    window.open(plan.phantomUrl, "_blank", "noopener");
  };

  const handleCopyReference = async (plan: WhalePlanOption) => {
    try {
      await navigator.clipboard?.writeText(plan.reference);
      setStatus("Reference copied.");
    } catch (err) {
      setError("Failed to copy reference.");
    }
  };

  const handlePayWithWallet = async (plan: WhalePlanOption) => {
    if (!publicKey || !signTransaction) {
      setError("Connect a wallet to pay from the browser.");
      return;
    }

    if (!PROJECT_WALLET) {
      setError("Project wallet is not configured.");
      return;
    }

    try {
      setStatus("Preparing payment transaction…");
      setSelectedPlan(plan);
      const referenceKey = new PublicKey(plan.reference);
      const lamports = new BigNumber(plan.amount)
        .multipliedBy(LAMPORTS_PER_SOL)
        .integerValue(BigNumber.ROUND_FLOOR)
        .toNumber();

      // Fetch blockhash from server-side endpoint (handles RPC fallback properly)
      setStatus("Fetching latest blockhash…");
      const blockhashRes = await fetch("/api/blockhash");
      if (!blockhashRes.ok) {
        const errorData = await blockhashRes.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to get blockhash from server");
      }
      const { blockhash, lastValidBlockHeight } = await blockhashRes.json();

      setStatus("Building transaction…");
      const transaction = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(PROJECT_WALLET),
          lamports,
        })
      );
      transaction.instructions[0].keys.push({
        pubkey: referenceKey,
        isSigner: false,
        isWritable: false,
      });

      // Use manual sign + send pattern (same as AI payment flow) to ensure proper broadcasting
      if (!signTransaction) {
        throw new Error("signTransaction not available");
      }
      
      setStatus("Requesting wallet signature…");
      const signed = await signTransaction(transaction);
      const serializedTx = signed.serialize();
      
      setStatus("Broadcasting transaction to network…");
      const signature = await connection.sendRawTransaction(serializedTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
      
      const sigStr = typeof signature === "string" ? signature : bs58.encode(signature);
      
      if (!sigStr || sigStr.length < 32) {
        throw new Error(`Invalid signature received: ${sigStr}`);
      }
      
      setStatus(`Transaction ${sigStr} submitted. Waiting for confirmation…`);

      // Use polling confirmation instead of findReference
      let confirmed = false;
      for (let i = 0; i < 60; i++) {
        const res = await fetch(`/api/confirm?sig=${sigStr}`);
        const data = await res.json();

        if (data.confirmed) {
          if (data.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(data.err)}`);
          }
          confirmed = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      if (!confirmed) {
        throw new Error("Confirmation timeout - transaction may still be processing. Check Solscan for status.");
      }

      setStatus("Payment confirmed. Finalizing access…");
      await fetchAlerts({ reference: plan.reference });
    } catch (err: any) {
      console.error("Wallet payment failed", err);
      setError(err?.message ?? "Wallet payment failed.");
    }
  };

  const handleConfirm = async () => {
    if (!selectedPlan) {
      setError("Select a plan first.");
      return;
    }
    setStatus("Verifying payment…");
    await fetchAlerts({ reference: selectedPlan.reference });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-emerald-300">Live Feed Preview</p>
            <h2 className="text-2xl font-bold">Real-Time Whale Movements</h2>
          </div>
          <button
            onClick={() => fetchAlerts()}
            className="rounded-full border border-emerald-400/40 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/10"
          >
            Refresh
          </button>
        </div>
        <ul className="mt-6 space-y-3">
          {previewAlerts.map((alert) => (
            <li
              key={`preview-${alert.id}`}
              className={`rounded-xl border border-white/5 bg-black/30 p-4 ${unlocked ? "" : blurClass}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold text-cyan-300">
                  {alert.direction.toUpperCase()} {alert.tokenSymbol ?? "TOKEN"}
                </p>
                <span className="text-sm text-white/60">
                  ${alert.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>
              <p className="text-xs text-white/60 mt-1">
                Wallet {alert.wallet.slice(0, 4)}…{alert.wallet.slice(-4)} •{" "}
                {new Date(alert.timestamp).toLocaleTimeString()}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {unlocked && alerts.length > 0 && (
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide text-green-300">
                Full Feed {walletAccess?.tier ? `(${walletAccess.tier})` : ""}
              </p>
              {walletAccess?.expiresInMs && (
                <p className="text-xs text-white/60">
                  Access expires in {Math.ceil(walletAccess.expiresInMs / 1000 / 60)} minutes
                </p>
              )}
            </div>
            <button
              onClick={() => fetchAlerts()}
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Refresh Now
            </button>
          </div>
          <ul className="space-y-3">
            {alerts.map((alert) => (
              <li key={alert.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold text-white">
                    {alert.direction.toUpperCase()} {alert.tokenSymbol ?? "TOKEN"}
                  </p>
                  <span className="text-sm font-semibold text-amber-300">
                    ${alert.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <p className="text-xs text-white/60">
                  Wallet {alert.wallet} • {new Date(alert.timestamp).toLocaleTimeString()} •{" "}
                  <a
                    href={`https://solscan.io/tx/${alert.signature}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 underline"
                  >
                    View TX
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!unlocked && (
        <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-black p-6 text-center space-y-4">
          <h3 className="text-2xl font-bold text-white">Unlock Real-Time Whale Alerts</h3>
          <p className="text-white/70 text-sm max-w-2xl mx-auto">
            Tap into the exact wallets aping into meme coins the moment they move. Pay once with SOL to monitor every $1K+ buy or sell across
            Solana in real time.
          </p>
          {!publicKey && <p className="text-amber-300 text-sm">Connect a wallet to continue.</p>}
          <button
            onClick={() => fetchAlerts()}
            disabled={!walletParam || loading}
            className="rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600 px-6 py-3 text-white font-semibold disabled:opacity-50"
          >
            {loading ? "Checking access..." : "Check Access"}
          </button>
        </section>
      )}

      {plans.length > 0 && (
        <section className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-6 space-y-4">
          <h4 className="text-xl font-semibold text-amber-200">Choose your plan</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {plans.map((plan) => (
              <div key={plan.reference} className="rounded-xl border border-white/20 bg-white/5 p-4 space-y-3">
                <div>
                  <p className="text-sm uppercase tracking-wide text-white/60">{plan.label}</p>
                  <p className="text-2xl font-bold text-white">{plan.amount} SOL</p>
                  <p className="text-xs text-white/50">
                    Access for {Math.round(plan.durationSeconds / 3600) >= 24
                      ? `${Math.round(plan.durationSeconds / 86400)} days`
                      : `${Math.round(plan.durationSeconds / 3600)} hours`}
                  </p>
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  <button
                    onClick={() => handleOpenPlan(plan)}
                    className="rounded-full border border-white/30 px-3 py-2 text-white hover:bg-white/10"
                  >
                    Open in Wallet
                  </button>
                  <button
                    onClick={() => handleCopyReference(plan)}
                    className="rounded-full border border-white/30 px-3 py-2 text-white hover:bg-white/10"
                  >
                    Copy Reference
                  </button>
                  {publicKey && (
                    <button
                      onClick={() => handlePayWithWallet(plan)}
                      className="rounded-full bg-green-600 px-3 py-2 text-white hover:bg-green-700"
                    >
                      Pay with Connected Wallet
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {selectedPlan && (
            <div className="rounded-xl border border-white/20 bg-black/30 p-4 text-sm text-white/80">
              <p>
                After paying, click the button below to finalize access. We’ll automatically grant whale alerts once the SOL transfer clears.
              </p>
              <button
                onClick={handleConfirm}
                className="mt-3 rounded-full bg-white/10 px-4 py-2 text-white hover:bg-white/20"
              >
                I Paid – Refresh Access
              </button>
            </div>
          )}
        </section>
      )}

      {(status || error) && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            error ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-cyan-500/40 bg-cyan-500/10 text-cyan-100"
          }`}
        >
          {error || status}
        </div>
      )}
    </div>
  );
}

