import { encodeURL, TransferRequestURLFields } from "@solana/pay";
import { PublicKey } from "@solana/web3.js";
import { Decimal } from "decimal.js";

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

export function createSolanaPayURL(recipient: string, amount: number) {
  const recipientPubkey = new PublicKey(recipient);
  const reference = new PublicKey(getRandomBytes(32));

  const urlFields: TransferRequestURLFields = {
    recipient: recipientPubkey,
    amount: new Decimal(amount),
    reference,
    label: "SolAI PayHub - Balance Check",
    message: `Pay ${amount} SOL to unlock balance`,
  };

  const url = encodeURL(urlFields);

  return {
    url: url.toString(),
    reference: reference.toBase58(),
    amount,
  };
}