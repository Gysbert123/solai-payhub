import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection(process.env.NEXT_PUBLIC_RPC || "https://api.devnet.solana.com");
const PROJECT_WALLET = process.env.PROJECT_WALLET;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const sig = request.nextUrl.searchParams.get("sig");

  if (!address || !PROJECT_WALLET) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }

  try { new PublicKey(address); } catch { return NextResponse.json({ error: "Invalid" }, { status: 400 }); }

  if (sig) {
    try {
      const tx = await connection.getParsedTransaction(sig, { commitment: "confirmed" });
      if (tx && tx.transaction.message.instructions.some((ix: any) =>
        ix.parsed?.type === "transfer" &&
        ix.parsed?.info?.source === address &&
        ix.parsed?.info?.destination === PROJECT_WALLET &&
        ix.parsed?.info?.lamports === 1000000
      )) {
        return NextResponse.json({ unlocked: true });
      }
    } catch {}
  }

  return new NextResponse(null, { status: 402 });
}