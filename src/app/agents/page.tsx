"use client";

import { useState } from "react";
import Link from "next/link";

type InvoiceResponse = {
  requestId?: string;
  reference: string;
  amount: string;
  recipient: string;
  paymentUrl: string;
  phantomUrl?: string;
};

type GatewayDelivery = {
  status: string;
  response?: string;
  jupiterRecommendation?: string;
  signature?: string;
  costUsd?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
};

export default function AgentsGatewayPage() {
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("agent-001");
  const [agentWallet, setAgentWallet] = useState("");
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [reference, setReference] = useState("");
  const [delivery, setDelivery] = useState<GatewayDelivery | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const sanitizedAgentId = agentId.trim() || "anonymous";

  const handleCreateInvoice = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    setDelivery(null);
    setInvoice(null);

    if (!prompt.trim()) {
      setErrorMessage("Prompt is required.");
      return;
    }
    if (!agentWallet.trim()) {
      setErrorMessage("Agent wallet address is required.");
      return;
    }

    setCreatingInvoice(true);

    try {
      const res = await fetch("/api/agent/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          prompt: prompt.trim(),
          agentId: sanitizedAgentId,
          agentWallet: agentWallet.trim(),
        }),
      });

      const data = await res.json();

      if (res.status === 402) {
        setInvoice(data as InvoiceResponse);
        setReference(data.reference);
        setStatusMessage("Invoice created. Pay the Solana Pay link, then click “Check status”.");
      } else if (res.ok) {
        setDelivery(data as GatewayDelivery);
        setStatusMessage("Payment already confirmed; Grok response delivered.");
      } else {
        setErrorMessage(data.error || "Failed to create invoice.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error while creating invoice.");
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleCheckStatus = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (!reference.trim()) {
      setErrorMessage("Enter the reference to check payment status.");
      return;
    }

    setCheckingStatus(true);

    try {
      const res = await fetch("/api/agent/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ reference: reference.trim() }),
      });

      const data = await res.json();

      if (res.status === 200) {
        setDelivery(data as GatewayDelivery);
        setStatusMessage("Paid • Grok response delivered.");
      } else if (res.status === 402) {
        setStatusMessage("Payment pending. Wait a few seconds and try again.");
      } else {
        setErrorMessage(data.error || "Failed to check status.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error while checking status.");
    } finally {
      setCheckingStatus(false);
    }
  };

  const copyToClipboard = async (value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard?.writeText(value);
      setStatusMessage("Copied to clipboard!");
    } catch (err) {
      console.error("Clipboard error:", err);
      setErrorMessage("Unable to copy. Copy manually instead.");
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-wide text-amber-400">Agents · x402</p>
              <h1 className="text-4xl font-bold">Grok AI Gateway</h1>
            </div>
            <Link
              href="/"
              className="rounded-full border border-white/20 bg-white/5 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              ← Back to dashboard
            </Link>
          </div>
          <p className="text-lg text-white/80">
            Send any prompt, bill the agent 0.0015&nbsp;SOL via Solana Pay, and receive Grok’s full response plus a Jupiter trade idea.
          </p>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <p className="font-semibold text-teal-300">How it works</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Fill in the prompt + agent wallet → click <strong>Create invoice</strong>.</li>
              <li>Pay the Solana Pay link (wallet must match <code>agentWallet</code>).</li>
              <li>Paste the same reference, click <strong>Check status</strong> until it returns the Grok answer.</li>
            </ol>
            <p className="mt-3 text-xs text-white/60">
              Prefer raw APIs? See the updated{" "}
              <Link
                href="https://github.com/Gysbert123/solai-payhub/blob/main/MARKETPLACE_API.md"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline"
              >
                API for AI Agents
              </Link>
              .
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-2xl font-semibold text-cyan-300">1. Create invoice</h2>
          <label className="block text-sm uppercase tracking-wide text-white/60">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 p-3 text-white focus:border-cyan-400 focus:outline-none"
            placeholder="Explain why SOL could outperform the market this week..."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm uppercase tracking-wide text-white/60">Agent ID</label>
              <input
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 p-3 text-white focus:border-cyan-400 focus:outline-none"
                placeholder="agent-42"
              />
            </div>
            <div>
              <label className="block text-sm uppercase tracking-wide text-white/60">Agent Wallet (SOL)</label>
              <input
                value={agentWallet}
                onChange={(e) => setAgentWallet(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 p-3 text-white focus:border-cyan-400 focus:outline-none"
                placeholder="Wallet that will pay the invoice"
              />
            </div>
          </div>
          <button
            disabled={creatingInvoice}
            onClick={handleCreateInvoice}
            className="w-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-600 px-6 py-3 text-lg font-semibold shadow-lg transition hover:from-cyan-600 hover:to-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creatingInvoice ? "Creating invoice..." : "Create invoice (0.0015 SOL)"}
          </button>
        </section>

        {invoice && (
          <section className="rounded-2xl border border-white/10 bg-emerald-500/10 p-6 text-white">
            <h2 className="text-2xl font-semibold text-emerald-300">Invoice ready</h2>
            <p className="mt-2 text-sm text-white/80">
              Pay exactly {invoice.amount} SOL from <code>{agentWallet}</code>, then hit “Check status”.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-white/60">Payment URL</p>
                <button
                  onClick={() => copyToClipboard(invoice.paymentUrl)}
                  className="mt-1 w-full truncate rounded-xl border border-white/10 bg-black/40 p-3 text-left text-sm font-mono"
                  title={invoice.paymentUrl}
                >
                  {invoice.paymentUrl}
                </button>
              </div>
              <div>
                <p className="text-xs uppercase text-white/60">Reference</p>
                <button
                  onClick={() => copyToClipboard(invoice.reference)}
                  className="mt-1 w-full truncate rounded-xl border border-white/10 bg-black/40 p-3 text-left text-sm font-mono"
                  title={invoice.reference}
                >
                  {invoice.reference}
                </button>
              </div>
            </div>
            {invoice.phantomUrl && (
              <div className="mt-4">
                <a
                  href={invoice.phantomUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold transition hover:bg-purple-700"
                >
                  Open in Phantom
                </a>
              </div>
            )}
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
          <h2 className="text-2xl font-semibold text-amber-300">2. Check payment status</h2>
          <label className="block text-sm uppercase tracking-wide text-white/60">Reference</label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 p-3 text-white focus:border-amber-400 focus:outline-none"
            placeholder="Paste the reference from the invoice"
          />
          <button
            disabled={checkingStatus}
            onClick={handleCheckStatus}
            className="w-full rounded-full bg-gradient-to-r from-amber-500 to-pink-600 px-6 py-3 text-lg font-semibold shadow-lg transition hover:from-amber-600 hover:to-pink-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkingStatus ? "Checking..." : "Check status"}
          </button>
        </section>

        {(statusMessage || errorMessage) && (
          <div
            className={`rounded-xl border p-4 text-sm ${
              errorMessage
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-cyan-500/40 bg-cyan-500/10 text-cyan-100"
            }`}
          >
            {errorMessage || statusMessage}
          </div>
        )}

        {delivery && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold text-emerald-300">3. Grok response</h2>
              <span className="rounded-full border border-emerald-400/50 px-3 py-1 text-xs uppercase tracking-wide text-emerald-200">
                {delivery.status}
              </span>
            </div>
            {delivery.response ? (
              <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-4 text-sm leading-relaxed">
                {delivery.response}
              </pre>
            ) : (
              <p className="text-sm text-white/70">No response body yet.</p>
            )}
            {delivery.jupiterRecommendation && (
              <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                <p className="font-semibold uppercase tracking-wide text-xs text-yellow-300">Jupiter trade</p>
                <p>{delivery.jupiterRecommendation}</p>
              </div>
            )}
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase text-white/50">Signature</p>
                <p className="font-mono text-white/80">
                  {delivery.signature ? `${delivery.signature.slice(0, 4)}…${delivery.signature.slice(-4)}` : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase text-white/50">Cost (USD)</p>
                <p className="font-semibold text-white">{delivery.costUsd ?? "—"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase text-white/50">Tokens</p>
                <p className="font-mono text-white/80">
                  {delivery.tokens
                    ? `${delivery.tokens.input ?? 0} in / ${delivery.tokens.output ?? 0} out`
                    : "—"}
                </p>
              </div>
            </div>
          </section>
        )}

        <footer className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
          <p className="font-semibold text-white">Automation tips</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Agents should log the `reference` + transaction signature for every payment.</li>
            <li>Retry confirmations every 2–5 seconds until the endpoint returns `status: "delivered"`.</li>
            <li>Use the <code>/api/agent/gateway</code> docs (updated in <code>MARKETPLACE_API.md</code>) for direct integrations.</li>
          </ul>
        </footer>
      </div>
    </main>
  );
}


