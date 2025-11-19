"use server";

import { NextRequest, NextResponse } from "next/server";
import { encodeURL, FindReferenceError } from "@solana/pay";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import {
  deletePendingPlan,
  fetchWhaleAlerts,
  getPendingPlan,
  getWhaleAccess,
  grantWhaleAccess,
  savePendingPlan,
  WhalePlan,
  WhalePlanTier,
  WHALE_FEATURE_ID,
  WHALE_PLANS,
} from "@/lib/whale";

const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;
const SOLANA_ENDPOINT = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DEFAULT_MIN_USD = Number(process.env.WHALE_ALERT_MIN_USD ?? "1000");
const DEFAULT_LIMIT = Number(process.env.WHALE_ALERT_DEFAULT_LIMIT ?? "50");

type WhalePlanResponse = {
  tier: WhalePlanTier;
  label: string;
  amount: string;
  durationSeconds: number;
  reference: string;
  paymentUrl: string;
  phantomUrl: string;
};

function normalizeLimit(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(parsed)), 200);
}

function normalizeUsd(value: string | null): number {
  if (!value) return DEFAULT_MIN_USD;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_MIN_USD;
  return parsed;
}

function sanitizeWallet(value: string | null): string | null {
  if (!value) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch (_err) {
    return null;
  }
}

async function assertSolTransfer(
  connection: Connection,
  signature: string,
  recipient: PublicKey,
  expectedAmount: BigNumber,
  reference: PublicKey
) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx || !tx.meta) {
    throw new Error("transaction not found");
  }

  const message = tx.transaction.message;
  const keys =
    "getAccountKeys" in message
      ? [
          ...message.getAccountKeys({
            accountKeysFromLookups: {
              writable: tx.meta.loadedAddresses?.writable?.map((k) => new PublicKey(k)) ?? [],
              readonly: tx.meta.loadedAddresses?.readonly?.map((k) => new PublicKey(k)) ?? [],
            },
          }).staticAccountKeys,
        ]
      : (message.accountKeys as PublicKey[]);

  const hasReference = keys.some((key) => key.equals(reference));
  if (!hasReference) {
    throw new Error("reference not found in transaction");
  }

  const recipientIndex = keys.findIndex((key) => key.equals(recipient));
  if (recipientIndex === -1) {
    throw new Error("recipient not found in transaction");
  }

  const preBalance = tx.meta.preBalances?.[recipientIndex] ?? 0;
  const postBalance = tx.meta.postBalances?.[recipientIndex] ?? 0;
  const delta = new BigNumber(postBalance).minus(preBalance);
  const expectedLamports = expectedAmount.multipliedBy(LAMPORTS_PER_SOL).integerValue(BigNumber.ROUND_FLOOR);

  if (delta.lt(expectedLamports)) {
    throw new Error("insufficient amount received");
  }
}

function buildPlanInvoices(wallet: string): Array<{ plan: WhalePlan; reference: string; paymentUrl: string; phantomUrl: string }> {
  const recipient = new PublicKey(PROJECT_WALLET!);
  return Object.values(WHALE_PLANS).map((plan) => {
    const referenceKey = Keypair.generate().publicKey;
    const paymentUrl = encodeURL({
      recipient,
      amount: plan.amount,
      reference: referenceKey,
      label: "SolAI Whale Alerts",
      message: `${plan.label} for ${wallet}`,
      memo: `${WHALE_FEATURE_ID}:${plan.tier}`,
    }).toString();

    return {
      plan,
      reference: referenceKey.toBase58(),
      paymentUrl,
      phantomUrl: `https://phantom.app/ul/v1/pay?link=${encodeURIComponent(paymentUrl)}`,
    };
  });
}

export async function GET(req: NextRequest) {
  if (!PROJECT_WALLET) {
    return NextResponse.json({ error: "Project wallet misconfigured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const minUsd = normalizeUsd(url.searchParams.get("min_usd"));
  const walletParam = sanitizeWallet(url.searchParams.get("wallet"));
  const reference = url.searchParams.get("reference")?.trim() || null;

  if (preview) {
    const alerts = await fetchWhaleAlerts(limit, minUsd);
    return NextResponse.json({
      paid: false,
      alerts,
    });
  }

  if (!walletParam) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  }

  const connection = new Connection(SOLANA_ENDPOINT, "confirmed");

  if (reference) {
    const pending = await getPendingPlan(reference);
    if (!pending) {
      return NextResponse.json({ error: "reference not found or expired" }, { status: 404 });
    }
    if (pending.wallet !== walletParam) {
      return NextResponse.json({ error: "reference does not match wallet" }, { status: 403 });
    }

    try {
      const { tier, amountSol, durationMs } = pending;
      const referenceKey = new PublicKey(reference);
      const { signature } = await findReference(connection, new PublicKey(reference), {
        finality: "confirmed",
      });

      await assertSolTransfer(connection, signature, new PublicKey(PROJECT_WALLET), new BigNumber(amountSol), referenceKey);

      await grantWhaleAccess(walletParam, tier, durationMs);
      await deletePendingPlan(reference);
    } catch (err) {
      if (err instanceof FindReferenceError) {
        return NextResponse.json({ status: "pending" }, { status: 402 });
      }
      return NextResponse.json(
        { error: "validation_failed", details: err instanceof Error ? err.message : String(err) },
        { status: 422 }
      );
    }
  }

  const access = await getWhaleAccess(walletParam);
  if (access) {
    const alerts = await fetchWhaleAlerts(limit, minUsd);
    return NextResponse.json({
      paid: true,
      tier: access.tier,
      expiresInMs: access.expiresInMs,
      alerts,
    });
  }

  const invoices = buildPlanInvoices(walletParam);

  for (const invoice of invoices) {
    await savePendingPlan(invoice.reference, {
      wallet: walletParam,
      tier: invoice.plan.tier,
      amountSol: invoice.plan.amount.toString(),
      durationMs: invoice.plan.durationMs,
    });
  }

  const responsePlans: WhalePlanResponse[] = invoices.map((invoice) => ({
    tier: invoice.plan.tier,
    label: invoice.plan.label,
    amount: invoice.plan.amount.toFixed(6),
    durationSeconds: Math.floor(invoice.plan.durationMs / 1000),
    reference: invoice.reference,
    paymentUrl: invoice.paymentUrl,
    phantomUrl: invoice.phantomUrl,
  }));

  return NextResponse.json(
    {
      feature: WHALE_FEATURE_ID,
      message: "Payment required",
      plans: responsePlans,
    },
    {
      status: 402,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

