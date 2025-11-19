"use server";

import { NextRequest, NextResponse } from "next/server";
import { recordWhaleAlert, WhaleAlert } from "@/lib/whale";

const HELIUS_WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET;
const DEFAULT_MIN_USD = Number(process.env.WHALE_ALERT_MIN_USD ?? "1000");

type HeliusTokenTransfer = {
  tokenAmount?: number | string;
  tokenPriceUsd?: number | string;
    tokenSymbol?: string;
  mint?: string;
  mintSymbol?: string;
  fromUserAccount?: string | null;
  toUserAccount?: string | null;
  amount?: number | string;
  amountUsd?: number | string;
};

type HeliusWebhookPayload = {
  signature: string;
  timestamp?: number;
  type?: string;
  events?: Record<string, unknown>;
  tokenTransfers?: HeliusTokenTransfer[];
};

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function collectTransfers(payload: HeliusWebhookPayload): HeliusTokenTransfer[] {
  const transfers: HeliusTokenTransfer[] = [];
  if (Array.isArray(payload.tokenTransfers)) {
    transfers.push(...payload.tokenTransfers);
  }
  const possiblePaths = [
    (payload.events as any)?.swap?.tokenTransfers,
    (payload.events as any)?.token?.tokenTransfers,
    (payload.events as any)?.nft?.tokenTransfers,
  ];
  for (const maybe of possiblePaths) {
    if (Array.isArray(maybe)) {
      transfers.push(...maybe);
    }
  }
  return transfers;
}

function buildAlertsFromPayload(
  payload: HeliusWebhookPayload,
  minUsd: number
): WhaleAlert[] {
  const transfers = collectTransfers(payload);
  const alerts: WhaleAlert[] = [];
  const signature = payload.signature;
  const timestampMs =
    (payload.timestamp ? Number(payload.timestamp) * 1000 : Date.now());

  for (const transfer of transfers) {
    const tokenAmount = Math.abs(
      toNumber(transfer.tokenAmount ?? transfer.amount ?? 0)
    );
    const usdValueRaw =
      toNumber(transfer.amountUsd) ||
      tokenAmount * toNumber(transfer.tokenPriceUsd);
    if (!usdValueRaw || usdValueRaw < minUsd) {
      continue;
    }

    const symbol = transfer.tokenSymbol || transfer.mintSymbol;
    const mint = transfer.mint;
    const priceUsd = toNumber(transfer.tokenPriceUsd);
    const source = payload.type;

    const participants: Array<{ wallet: string; direction: "buy" | "sell" }> =
      [];
    if (transfer.toUserAccount) {
      participants.push({ wallet: transfer.toUserAccount, direction: "buy" });
    }
    if (transfer.fromUserAccount) {
      participants.push({ wallet: transfer.fromUserAccount, direction: "sell" });
    }

    if (!participants.length) {
      continue;
    }

    for (const part of participants) {
      alerts.push({
        id: `${signature}-${part.wallet}-${part.direction}`,
        signature,
        timestamp: timestampMs,
        wallet: part.wallet,
        direction: part.direction,
        tokenSymbol: symbol ?? undefined,
        tokenMint: mint ?? undefined,
        tokenAmount,
        usdValue: usdValueRaw,
        priceUsd: priceUsd || undefined,
        source,
      });
    }
  }

  return alerts;
}

export async function POST(req: NextRequest) {
  if (HELIUS_WEBHOOK_SECRET) {
    const headerSecret =
      req.headers.get("x-helius-signature") || req.headers.get("x-helius-secret");
    if (headerSecret !== HELIUS_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: "invalid signature" },
        { status: 401 }
      );
    }
  }

  const payload = await req.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const events: HeliusWebhookPayload[] = Array.isArray(payload)
    ? payload
    : [payload];

  const minUsd = DEFAULT_MIN_USD;
  let stored = 0;

  for (const evt of events) {
    const alerts = buildAlertsFromPayload(evt, minUsd);
    for (const alert of alerts) {
      await recordWhaleAlert(alert);
      stored += 1;
    }
  }

  return NextResponse.json({
    received: events.length,
    stored,
  });
}

