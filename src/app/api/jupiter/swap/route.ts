import { NextRequest, NextResponse } from "next/server";

const JUPITER_API = "https://quote-api.jup.ag/v6/swap";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const res = await fetch(JUPITER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error("Swap failed");

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Jupiter swap error:", err);
    return NextResponse.json({ error: "Swap failed" }, { status: 500 });
  }
}