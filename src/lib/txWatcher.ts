import { Connection, Commitment } from "@solana/web3.js";

type WatchStatus = "pending" | "confirmed" | "error" | "timeout";

type Subscriber = (payload: { status: WatchStatus; error?: string }) => void;

type WatchState = {
  subscribers: Set<Subscriber>;
  status: WatchStatus;
  error?: string;
  unsubscribeId?: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const watchers = new Map<string, WatchState>();
const commitment: Commitment = "confirmed";

declare global {
  // eslint-disable-next-line no-var
  var __txWatcherConnection: Connection | undefined;
}

function getConnection() {
  if (!process.env.SOLANA_RPC_URL) {
    throw new Error("SOLANA_RPC_URL is not configured for tx watcher.");
  }
  if (!globalThis.__txWatcherConnection) {
    globalThis.__txWatcherConnection = new Connection(process.env.SOLANA_RPC_URL, commitment);
  }
  return globalThis.__txWatcherConnection;
}

function finalize(signature: string, status: WatchStatus, error?: string) {
  const state = watchers.get(signature);
  if (!state) return;

  state.status = status;
  state.error = error;

  state.subscribers.forEach((subscriber) => {
    try {
      subscriber({ status, error });
    } catch {
      // ignore subscriber errors
    }
  });

  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
  }
  if (state.unsubscribeId !== undefined) {
    getConnection().removeSignatureListener(state.unsubscribeId);
  }
  state.cleanupTimer = setTimeout(() => {
    watchers.delete(signature);
  }, 60_000);
}

function ensureWatch(signature: string) {
  let state = watchers.get(signature);
  if (state) {
    return state;
  }

  const connection = getConnection();
  state = {
    subscribers: new Set(),
    status: "pending",
  };
  watchers.set(signature, state);

  const unsubscribeId = connection.onSignature(
    signature,
    async (result) => {
      if (result.err) {
        // Fetch transaction to get detailed error
        try {
          const tx = await connection.getTransaction(signature, {
            commitment,
            maxSupportedTransactionVersion: 0,
          });
          const errorMsg = tx?.meta?.err
            ? JSON.stringify(tx.meta.err)
            : "Transaction failed";
          finalize(signature, "error", errorMsg);
        } catch {
          finalize(signature, "error", "Transaction failed");
        }
      } else {
        finalize(signature, "confirmed");
      }
    },
    commitment
  );
  state.unsubscribeId = unsubscribeId;

  state.timeoutId = setTimeout(() => {
    finalize(signature, "timeout", "Confirmation timeout exceeded");
  }, 120_000);

  return state;
}

export function watchSignature(signature: string) {
  ensureWatch(signature);
}

export function addSubscriber(signature: string, subscriber: Subscriber) {
  const state = ensureWatch(signature);
  state.subscribers.add(subscriber);

  if (state.status !== "pending") {
    subscriber({ status: state.status, error: state.error });
  }

  return () => {
    const currentState = watchers.get(signature);
    if (!currentState) return;
    currentState.subscribers.delete(subscriber);
    if (currentState.subscribers.size === 0 && currentState.status !== "pending") {
      if (currentState.cleanupTimer) {
        clearTimeout(currentState.cleanupTimer);
      }
      watchers.delete(signature);
    }
  };
}

