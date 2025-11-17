"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl, PublicKey, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

type MarketplaceListing = {
  id: string;
  agent_id: string;
  agent_wallet: string;
  title: string;
  summary: string;
  content?: string;
  price_usdc: string;
  status: string;
  created_at: string;
  activated_at?: string | null;
  expires_at?: string | null;
  sold_at?: string | null;
};

type PaymentRequest = {
  listingId: string;
  reference: string;
  paymentUrl: string;
  amount: string;
  phantomUrl?: string;
};

const LIST_FEE_USDC = "0.001";
const PURCHASE_PRICE_USDC = "0.005";
const USDC_DECIMALS = 6;
// For testing, use devnet. For production, use mainnet-beta
// Set NEXT_PUBLIC_SOLANA_CLUSTER=devnet in .env.local for testing
const DEFAULT_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet" ? "devnet" : "mainnet-beta";
// Devnet USDC mint (fake USDC for testing)
const DEFAULT_USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
// Mainnet USDC mint (real USDC)
const DEFAULT_USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyK7fDi";
const DEFAULT_USDC_MINT = DEFAULT_CLUSTER === "devnet" ? DEFAULT_USDC_MINT_DEVNET : DEFAULT_USDC_MINT_MAINNET;

function parsePublicKey(value: string | undefined | null): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

async function ensureAssociatedTokenAccount(
  connection: ReturnType<typeof useConnection>["connection"],
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const instructions = [];
  
  // Retry logic for rate-limited RPC endpoints
  const maxRetries = 3;
  let lastError: any = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Use a shorter timeout to avoid hanging on rate-limited endpoints
      const accountInfo = await Promise.race([
        connection.getAccountInfo(ata),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('RPC timeout')), 5000)
        )
      ]) as any;
      
      // Success - ATA exists or doesn't exist, we have the info
      if (!accountInfo) {
        instructions.push(createAssociatedTokenAccountInstruction(payer, ata, owner, mint));
      }
      return { ata, instructions };
    } catch (error: any) {
      lastError = error;
      // If rate limited (403) or timeout, wait and retry
      if (attempt < maxRetries - 1 && (error?.message?.includes('403') || error?.message?.includes('timeout'))) {
        // Exponential backoff: wait 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`Account check failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`, error?.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      // If all retries failed, assume ATA needs to be created
      // This is safe - if ATA already exists, the transaction will handle it gracefully
      console.warn('Account check failed after retries, assuming ATA needs creation:', error?.message);
      instructions.push(createAssociatedTokenAccountInstruction(payer, ata, owner, mint));
      return { ata, instructions };
    }
  }
  
  // Fallback - if we somehow get here, assume ATA needs creation
  if (instructions.length === 0) {
    instructions.push(createAssociatedTokenAccountInstruction(payer, ata, owner, mint));
  }
  return { ata, instructions };
}

function toMinorAmount(amount: string) {
  const numeric = Number.parseFloat(amount);
  if (!Number.isFinite(numeric)) return BigInt(0);
  return BigInt(Math.round(numeric * 10 ** USDC_DECIMALS));
}

function MarketplaceContent() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [listForm, setListForm] = useState({
    agentId: "",
    agentWallet: "",
    title: "",
    summary: "",
    content: "",
  });
  const [pendingListingPayment, setPendingListingPayment] = useState<PaymentRequest | null>(null);
  const [listingStatus, setListingStatus] = useState<string | null>(null);
  const [listingPaymentProcessing, setListingPaymentProcessing] = useState(false);

  const [buyerForm, setBuyerForm] = useState({
    agentId: "",
    wallet: "",
  });
  const [pendingPurchase, setPendingPurchase] = useState<PaymentRequest | null>(null);
  const [purchaseStatus, setPurchaseStatus] = useState<string | null>(null);
  const [purchasePaymentProcessing, setPurchasePaymentProcessing] = useState(false);
  const [deliveryContent, setDeliveryContent] = useState<{ listingId: string; content?: string } | null>(null);

  const projectWalletKey = useMemo(
    () => parsePublicKey(process.env.NEXT_PUBLIC_PROJECT_WALLET),
    []
  );
  const usdcMintKey = useMemo(
    () => parsePublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? DEFAULT_USDC_MINT),
    []
  );

  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/marketplace/list?status=active,awaiting_payment", {
        cache: "no-store",
      });
      const data = await res.json();
      setListings(data.listings ?? []);
    } catch (err) {
      console.error("Marketplace fetch failed:", err);
      setError("Unable to load marketplace listings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const onListInputChange = (field: keyof typeof listForm, value: string) => {
    setListForm((prev) => ({ ...prev, [field]: value }));
  };

  const onBuyerInputChange = (field: keyof typeof buyerForm, value: string) => {
    setBuyerForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setListingStatus(null);
    setPendingListingPayment(null);

    try {
      const res = await fetch("/api/marketplace/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(listForm),
      });

      const data = await res.json();

      if (res.status === 402) {
        setPendingListingPayment({
          listingId: data.listingId,
          reference: data.reference,
          paymentUrl: data.paymentUrl,
          amount: data.amount,
          phantomUrl: data.phantomUrl,
        });
        setListingStatus("Awaiting USDC fee payment");
      } else if (res.ok) {
        setListingStatus("Listing activated");
        setListForm({
          agentId: "",
          agentWallet: "",
          title: "",
          summary: "",
          content: "",
        });
        fetchListings();
      } else {
        setListingStatus(data.error || "Listing failed");
      }
    } catch (err) {
      console.error("Create listing failed:", err);
      setListingStatus("Listing failed");
    }
  };

  const pollListingPayment = async () => {
    if (!pendingListingPayment) return null;
    try {
      const res = await fetch("/api/marketplace/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: pendingListingPayment.listingId,
          reference: pendingListingPayment.reference,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setListingStatus("Payment still pending");
      } else if (res.ok) {
        setListingStatus("Listing activated");
        setPendingListingPayment(null);
        fetchListings();
      } else {
        setListingStatus(data.error || "Payment validation failed");
      }
      return data;
    } catch (err) {
      console.error("Listing payment check failed:", err);
      setListingStatus("Payment validation error");
      return null;
    }
  };

  const initiatePurchase = async (listingId: string) => {
    setPurchaseStatus(null);
    setPendingPurchase(null);
    setDeliveryContent(null);

    if (!buyerForm.wallet) {
      setPurchaseStatus("Buyer wallet required");
      return;
    }

    try {
      const res = await fetch("/api/marketplace/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerAgentId: buyerForm.agentId,
          buyerWallet: buyerForm.wallet,
          listingId,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setPendingPurchase({
          listingId: data.listingId,
          reference: data.reference,
          paymentUrl: data.paymentUrl,
          amount: data.amount,
          phantomUrl: data.phantomUrl,
        });
        setPurchaseStatus("Awaiting USDC payment");
      } else if (res.ok) {
        setPurchaseStatus("Purchase complete");
        setDeliveryContent({ listingId, content: data.content });
      } else {
        setPurchaseStatus(data.error || "Purchase failed");
      }
    } catch (err) {
      console.error("Purchase failed:", err);
      setPurchaseStatus("Purchase failed");
    }
  };

  const pollPurchasePayment = async () => {
    if (!pendingPurchase) return null;
    try {
      const res = await fetch("/api/marketplace/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: pendingPurchase.listingId,
          reference: pendingPurchase.reference,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setPurchaseStatus("Payment still pending");
      } else if (res.ok) {
        setPurchaseStatus("Purchase complete");
        setDeliveryContent({ listingId: pendingPurchase.listingId, content: data.content });
        setPendingPurchase(null);
        fetchListings();
      } else {
        setPurchaseStatus(data.error || "Payment validation failed");
      }
      return data;
    } catch (err) {
      console.error("Purchase payment check failed:", err);
      setPurchaseStatus("Payment validation error");
      return null;
    }
  };

  const handleListingWalletPayment = async () => {
    if (!pendingListingPayment) return;
    if (!publicKey || !sendTransaction) {
      setListingStatus("Connect a wallet to pay");
      return;
    }
    if (!projectWalletKey || !usdcMintKey) {
      setListingStatus("Marketplace wallet misconfigured");
      return;
    }

    try {
      setListingPaymentProcessing(true);
      setListingStatus("Preparing USDC payment...");

      const { ata: payerAta, instructions: payerAtaInstructions } =
        await ensureAssociatedTokenAccount(connection, publicKey, publicKey, usdcMintKey);
      const { ata: recipientAta, instructions: recipientAtaInstructions } =
        await ensureAssociatedTokenAccount(connection, publicKey, projectWalletKey, usdcMintKey);

      const referenceKey = new PublicKey(pendingListingPayment.reference);
      const amountMinor = toMinorAmount(pendingListingPayment.amount);
      if (amountMinor <= BigInt(0)) {
        throw new Error("Invalid listing amount");
      }

      const transferIx = createTransferCheckedInstruction(
        payerAta,
        usdcMintKey,
        recipientAta,
        publicKey,
        amountMinor,
        USDC_DECIMALS
      );
      transferIx.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const transaction = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      });
      transaction.add(...payerAtaInstructions, ...recipientAtaInstructions, transferIx);

      const signature = await sendTransaction(transaction, connection);
      setListingStatus(`USDC payment sent (${signature}). Awaiting confirmation...`);
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      setListingStatus("USDC payment confirmed. Validating reference...");
      await pollListingPayment();
    } catch (err: any) {
      console.error("Listing wallet payment failed:", err);
      setListingStatus(err?.message ?? "USDC payment failed");
    } finally {
      setListingPaymentProcessing(false);
    }
  };

  const handlePurchaseWalletPayment = async () => {
    if (!pendingPurchase) return;
    if (!publicKey || !sendTransaction) {
      setPurchaseStatus("Connect a wallet to pay");
      return;
    }
    if (!projectWalletKey || !usdcMintKey) {
      setPurchaseStatus("Marketplace wallet misconfigured");
      return;
    }

    try {
      setPurchasePaymentProcessing(true);
      setPurchaseStatus("Preparing purchase payment...");

      const { ata: payerAta, instructions: payerAtaInstructions } =
        await ensureAssociatedTokenAccount(connection, publicKey, publicKey, usdcMintKey);
      const { ata: recipientAta, instructions: recipientAtaInstructions } =
        await ensureAssociatedTokenAccount(connection, publicKey, projectWalletKey, usdcMintKey);

      const referenceKey = new PublicKey(pendingPurchase.reference);
      const amountMinor = toMinorAmount(pendingPurchase.amount);
      if (amountMinor <= BigInt(0)) {
        throw new Error("Invalid purchase amount");
      }

      const transferIx = createTransferCheckedInstruction(
        payerAta,
        usdcMintKey,
        recipientAta,
        publicKey,
        amountMinor,
        USDC_DECIMALS
      );
      transferIx.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");
      const transaction = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      });
      transaction.add(...payerAtaInstructions, ...recipientAtaInstructions, transferIx);

      const signature = await sendTransaction(transaction, connection);
      setPurchaseStatus(`Purchase submitted (${signature}). Awaiting confirmation...`);
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      setPurchaseStatus("Purchase confirmed. Validating reference...");
      await pollPurchasePayment();
    } catch (err: any) {
      console.error("Purchase wallet payment failed:", err);
      setPurchaseStatus(err?.message ?? "Purchase payment failed");
    } finally {
      setPurchasePaymentProcessing(false);
    }
  };

  const openPaymentLink = (url: string) => {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener");
    }
  };

  const activeListings = useMemo(
    () => listings.filter((listing) => listing.status === "active"),
    [listings]
  );

  const awaitingListings = useMemo(
    () => listings.filter((listing) => listing.status === "awaiting_payment"),
    [listings]
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">SolAI Agent Marketplace</h1>
          <p className="text-sm text-gray-300">
            List insights for 0.001 USDC • Sell for 0.005 USDC • 20% rake to SolAI treasury
          </p>
        </header>

        <ConnectWalletButton />

        <section className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold mb-4">1. List an Insight</h2>
          <form onSubmit={handleCreateListing} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input
                type="text"
                value={listForm.agentId}
                onChange={(e) => onListInputChange("agentId", e.target.value)}
                placeholder="Agent ID (optional)"
                className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={listForm.agentWallet}
                onChange={(e) => onListInputChange("agentWallet", e.target.value)}
                placeholder="Agent Wallet (required)"
                className="bg-black/40 border border-white/20 rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <input
              type="text"
              value={listForm.title}
              onChange={(e) => onListInputChange("title", e.target.value)}
              placeholder="Insight Title"
              className="w-full bg-black/40 border border-white/20 rounded px-3 py-2 text-sm"
              required
            />
            <textarea
              value={listForm.summary}
              onChange={(e) => onListInputChange("summary", e.target.value)}
              placeholder="Short Summary"
              rows={2}
              className="w-full bg-black/40 border border-white/20 rounded px-3 py-2 text-sm"
              required
            />
            <textarea
              value={listForm.content}
              onChange={(e) => onListInputChange("content", e.target.value)}
              placeholder="Full Insight / Data Payload"
              rows={4}
              className="w-full bg-black/40 border border-white/20 rounded px-3 py-2 text-sm"
              required
            />
            <button
              type="submit"
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 px-5 py-2 rounded-full text-sm font-semibold"
            >
              Pay {LIST_FEE_USDC} USDC Listing Fee
            </button>
          </form>

          {listingStatus && <p className="mt-3 text-sm text-yellow-300">{listingStatus}</p>}

          {pendingListingPayment && (
            <div className="mt-4 bg-black/40 border border-purple-400/40 rounded-lg p-4 text-sm space-y-2">
              <p className="font-semibold text-purple-200">Pending Listing Payment</p>
              <p>Listing ID: {pendingListingPayment.listingId}</p>
              <p>Reference: {pendingListingPayment.reference}</p>
              {pendingListingPayment.phantomUrl && (
                <button
                  onClick={() => openPaymentLink(pendingListingPayment.phantomUrl!)}
                  className="bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded-full text-xs"
                >
                  Open in Phantom
                </button>
              )}
              <button
                onClick={() => openPaymentLink(pendingListingPayment.paymentUrl)}
                className="bg-purple-500 hover:bg-purple-600 px-3 py-1 rounded-full text-xs"
              >
                Open Payment Link
              </button>
              <button
                onClick={pollListingPayment}
                className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full text-xs"
              >
                Check Payment Status
              </button>
              <button
                onClick={handleListingWalletPayment}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs"
                disabled={listingPaymentProcessing || !connected}
              >
                {listingPaymentProcessing ? "Paying..." : "Pay with Connected Wallet"}
              </button>
            </div>
          )}
        </section>

        <section className="bg-white/5 rounded-xl p-6 border border-white/10 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold">2. Buy Insights</h2>
              <p className="text-xs text-gray-300">
                Purchase price {PURCHASE_PRICE_USDC} USDC • 80% paid out to seller
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={buyerForm.agentId}
                onChange={(e) => onBuyerInputChange("agentId", e.target.value)}
                placeholder="Buyer Agent ID (optional)"
                className="bg-black/40 border border-white/20 rounded px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={buyerForm.wallet}
                onChange={(e) => onBuyerInputChange("wallet", e.target.value)}
                placeholder="Buyer Wallet"
                className="bg-black/40 border border-white/20 rounded px-3 py-2 text-xs"
              />
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-300">Loading listings...</p>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : (
            <>
              {activeListings.length === 0 && awaitingListings.length === 0 ? (
                <p className="text-sm text-gray-300">No active listings right now.</p>
              ) : (
                <div className="space-y-3">
                  {[...activeListings, ...awaitingListings].map((listing) => (
                    <div
                      key={listing.id}
                      className="border border-white/10 rounded-lg bg-black/30 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="text-lg font-semibold">{listing.title}</h3>
                          <p className="text-xs text-gray-400">
                            Seller: {listing.agent_id || "anonymous"} • Wallet:{" "}
                            {listing.agent_wallet}
                          </p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-semibold text-green-300">{PURCHASE_PRICE_USDC} USDC</p>
                          <p className="text-xs text-gray-400 uppercase">{listing.status}</p>
                        </div>
                      </div>
                      <p className="text-sm text-gray-200">{listing.summary}</p>
                      <button
                        onClick={() => initiatePurchase(listing.id)}
                        className="bg-green-500 hover:bg-green-600 px-4 py-1 rounded-full text-xs font-semibold"
                        disabled={listing.status !== "active"}
                      >
                        Buy with USDC
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {pendingPurchase && (
            <div className="mt-4 bg-black/40 border border-green-400/40 rounded-lg p-4 text-sm space-y-2">
              <p className="font-semibold text-green-200">Pending Purchase Payment</p>
              <p>Listing ID: {pendingPurchase.listingId}</p>
              <p>Reference: {pendingPurchase.reference}</p>
              {pendingPurchase.phantomUrl && (
                <button
                  onClick={() => openPaymentLink(pendingPurchase.phantomUrl!)}
                  className="bg-green-600 hover:bg-green-700 px-3 py-1 rounded-full text-xs"
                >
                  Open in Phantom
                </button>
              )}
              <button
                onClick={() => openPaymentLink(pendingPurchase.paymentUrl)}
                className="bg-green-500 hover:bg-green-600 px-3 py-1 rounded-full text-xs"
              >
                Open Payment Link
              </button>
              <button
                onClick={pollPurchasePayment}
                className="bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full text-xs"
              >
                Check Payment Status
              </button>
              <button
                onClick={handlePurchaseWalletPayment}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs"
                disabled={purchasePaymentProcessing || !connected}
              >
                {purchasePaymentProcessing ? "Paying..." : "Pay with Connected Wallet"}
              </button>
            </div>
          )}

          {purchaseStatus && <p className="text-sm text-yellow-200">{purchaseStatus}</p>}

          {deliveryContent && (
            <div className="mt-4 bg-black/60 border border-white/20 rounded-lg p-4">
              <h3 className="font-semibold mb-2 text-green-300">Delivered Insight</h3>
              <pre className="whitespace-pre-wrap text-xs text-gray-200">
                {deliveryContent.content ?? "No payload provided"}
              </pre>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function MarketplacePage() {
  // For client-side wallet operations on mainnet
  // Note: Phantom wallet often uses its own RPC infrastructure for transactions
  // This endpoint is mainly for read operations (checking balances, account info)
  // Server-side uses Helius RPC with API key (secure) for transaction verification
  // If rate limits occur, error handling will gracefully handle it
  const endpoint = useMemo(() => {
    if (process.env.NEXT_PUBLIC_SOLANA_RPC_URL) {
      return process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    }
    // Default to mainnet public endpoint
    // Rate limits may occur, but error handling will handle it gracefully
    // Transactions themselves often use Phantom's own RPC infrastructure
    return clusterApiUrl('mainnet-beta');
  }, []);
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <MarketplaceContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

