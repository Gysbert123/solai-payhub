import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const PROJECT_WALLET = process.env.NEXT_PUBLIC_PROJECT_WALLET;

export async function POST(req: NextRequest) {
  try {
    const { address, signature } = await req.json();
    console.log("AI Request:", { address, signature });

    if (!address || !signature || !PROJECT_WALLET) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    // Wait for tx
    let tx;
    for (let i = 0; i < 6; i++) {
      tx = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!tx) {
      console.log("Tx not found after 6 retries");
      return NextResponse.json({ error: "Tx not found" }, { status: 400 });
    }

    // Find transfer instruction
    const instructions = tx.transaction.message.instructions;
    const transfer = instructions.find((inst: any) => 
      inst.programId.toBase58() === "11111111111111111111111111111111" && 
      inst.parsed?.type === "transfer"
    );

    if (!transfer?.parsed) {
      console.log("No transfer found");
      return NextResponse.json({ error: "No transfer in tx" }, { status: 400 });
    }

    const { source, destination, lamports } = transfer.parsed.info;

    console.log("Parsed transfer:", { source, destination, lamports });

    if (
      lamports !== 100000 ||
      source !== address ||
      destination !== PROJECT_WALLET
    ) {
      console.log("Invalid payment details");
      return NextResponse.json({ error: "Invalid payment" }, { status: 400 });
    }

    console.log("PAYMENT VALID — SENDING INSIGHT");

    return NextResponse.json({
      meme: "PUMPED",
      score: Math.floor(Math.random() * 30) + 70,
      arb: "Buy Raydium → Sell Jupiter",
      risk: "Low",
    });
  } catch (err: any) {
    console.error("AI API CRASH:", err.message);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}