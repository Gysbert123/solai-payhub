import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { Wallet } from "@solana/wallet-adapter-react";

const JUPITER_API = "https://quote-api.jup.ag/v6";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quoteResponse, userPublicKey } = body;

    const response = await fetch(`${JUPITER_API}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    const { swapTransaction } = await response.json();
    return NextResponse.json({ swapTransaction });
  } catch (err) {
    return NextResponse.json({ error: "Swap failed" }, { status: 500 });
  }
}