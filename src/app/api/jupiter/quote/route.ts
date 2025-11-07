import { NextRequest, NextResponse } from "next/server";

const JUPITER_API = "https://quote-api.jup.ag/v6/quote";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params = searchParams.toString();

  try {
    const res = await fetch(`${JUPITER_API}?${params}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) throw new Error("Jupiter failed");

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Jupiter quote error:", err);
    return NextResponse.json({ error: "No route" }, { status: 500 });
  }
}