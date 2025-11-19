import BigNumber from "bignumber.js";
import { kvDel, kvGet, kvLpushTrim, kvLrange, kvSet, kvSetMs, kvTtl } from "./kv";

export const WHALE_FEATURE_ID = "whale-alerts";

export type WhaleAlert = {
  id: string;
  signature: string;
  timestamp: number;
  wallet: string;
  direction: "buy" | "sell";
  tokenSymbol?: string;
  tokenMint?: string;
  tokenAmount: number;
  usdValue: number;
  priceUsd?: number;
  source?: string;
};

const ALERT_LIST_KEY = "whale:alerts";
const ACCESS_KEY_PREFIX = "whale:access:";
const PENDING_KEY_PREFIX = "whale:pending:";

const MAX_ALERTS = Number(process.env.WHALE_ALERTS_MAX ?? "200");

export const HOURLY_PRICE_SOL = new BigNumber(
  process.env.WHALE_HOURLY_PRICE_SOL ?? "0.0005"
);
export const HOURLY_DURATION_MS = Number(
  process.env.WHALE_HOURLY_DURATION_MS ?? 60 * 60 * 1000
);

export const MONTHLY_PRICE_SOL = new BigNumber(
  process.env.WHALE_MONTHLY_PRICE_SOL ?? "0.01"
);
export const MONTHLY_DURATION_MS = Number(
  process.env.WHALE_MONTHLY_DURATION_MS ?? 30 * 24 * 60 * 60 * 1000
);

export type WhalePlanTier = "hourly" | "monthly";

export type WhalePlan = {
  tier: WhalePlanTier;
  label: string;
  amount: BigNumber;
  durationMs: number;
};

export const WHALE_PLANS: Record<WhalePlanTier, WhalePlan> = {
  hourly: {
    tier: "hourly",
    label: "1 Hour Pass",
    amount: HOURLY_PRICE_SOL,
    durationMs: HOURLY_DURATION_MS,
  },
  monthly: {
    tier: "monthly",
    label: "30-Day Pass",
    amount: MONTHLY_PRICE_SOL,
    durationMs: MONTHLY_DURATION_MS,
  },
};

export async function recordWhaleAlert(alert: WhaleAlert) {
  await kvLpushTrim(ALERT_LIST_KEY, JSON.stringify(alert), MAX_ALERTS);
}

export async function fetchWhaleAlerts(
  limit: number,
  minUsd: number
): Promise<WhaleAlert[]> {
  const raw = await kvLrange(ALERT_LIST_KEY, 0, limit - 1);
  const parsed = raw
    .map((item) => {
      try {
        return JSON.parse(item) as WhaleAlert;
      } catch (_err) {
        return null;
      }
    })
    .filter((item): item is WhaleAlert => Boolean(item));

  return parsed.filter((alert) => alert.usdValue >= minUsd);
}

export type PendingPlan = {
  wallet: string;
  tier: WhalePlanTier;
  amountSol: string;
  durationMs: number;
};

export async function savePendingPlan(reference: string, plan: PendingPlan) {
  await kvSet(pendingKey(reference), JSON.stringify(plan), 60 * 60); // 1 hour TTL
}

function pendingKey(reference: string) {
  return `${PENDING_KEY_PREFIX}${reference}`;
}

export async function getPendingPlan(
  reference: string
): Promise<PendingPlan | null> {
  const raw = await kvGet(pendingKey(reference));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPlan;
  } catch {
    return null;
  }
}

export async function deletePendingPlan(reference: string) {
  await kvDel(pendingKey(reference));
}

export type AccessGrant = {
  wallet: string;
  tier: WhalePlanTier;
  expiresAt: number;
};

export async function grantWhaleAccess(
  wallet: string,
  tier: WhalePlanTier,
  durationMs: number
) {
  const key = `${ACCESS_KEY_PREFIX}${wallet}`;
  const expiresAt = Date.now() + durationMs;
  const payload: AccessGrant = {
    wallet,
    tier,
    expiresAt,
  };
  await kvSetMs(key, JSON.stringify(payload), durationMs);
}

export async function getWhaleAccess(
  wallet: string
): Promise<{ tier: WhalePlanTier; expiresInMs: number } | null> {
  const key = `${ACCESS_KEY_PREFIX}${wallet}`;
  const raw = await kvGet(key);
  if (!raw) return null;
  try {
    const grant = JSON.parse(raw) as AccessGrant;
    const ttlSeconds = await kvTtl(key);
    if (ttlSeconds <= 0) {
      await kvDel(key);
      return null;
    }
    return {
      tier: grant.tier,
      expiresInMs: ttlSeconds * 1000,
    };
  } catch (_err) {
    await kvDel(key);
    return null;
  }
}

