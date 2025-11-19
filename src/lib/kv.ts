import { Redis } from "@upstash/redis";

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

const memoryStore = new Map<string, MemoryEntry>();
const memoryLists = new Map<string, string[]>();

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

async function pruneMemoryKey(key: string) {
  const entry = memoryStore.get(key);
  if (entry && entry.expiresAt <= Date.now()) {
    memoryStore.delete(key);
  }
}

export async function kvSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void> {
  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds });
    return;
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function kvSetMs(
  key: string,
  value: string,
  ttlMs: number
): Promise<void> {
  if (redis) {
    await redis.set(key, value, { px: ttlMs });
    return;
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export async function kvGet(key: string): Promise<string | null> {
  if (redis) {
    const value = await redis.get<string>(key);
    return value ?? null;
  }
  await pruneMemoryKey(key);
  return memoryStore.get(key)?.value ?? null;
}

export async function kvDel(key: string): Promise<void> {
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryStore.delete(key);
}

export async function kvTtl(key: string): Promise<number> {
  if (redis) {
    const ttl = await redis.ttl(key);
    return ttl ?? -1;
  }
  await pruneMemoryKey(key);
  const entry = memoryStore.get(key);
  if (!entry) return -1;
  return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
}

export async function kvLpushTrim(
  key: string,
  value: string,
  maxLen: number
): Promise<void> {
  if (redis) {
    await redis.lpush(key, value);
    await redis.ltrim(key, 0, maxLen - 1);
    return;
  }
  const list = memoryLists.get(key) ?? [];
  list.unshift(value);
  if (list.length > maxLen) {
    list.length = maxLen;
  }
  memoryLists.set(key, list);
}

export async function kvLrange(
  key: string,
  start: number,
  end: number
): Promise<string[]> {
  if (redis) {
    const values = await redis.lrange<string>(key, start, end);
    return values ?? [];
  }
  const list = memoryLists.get(key) ?? [];
  return list.slice(start, end === -1 ? undefined : end + 1);
}

export async function kvExists(key: string): Promise<boolean> {
  if (redis) {
    const exists = await redis.exists(key);
    return Boolean(exists);
  }
  await pruneMemoryKey(key);
  return memoryStore.has(key);
}

