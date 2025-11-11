import { NextRequest, NextResponse } from "next/server";

const JUPITER_API = "https://quote-api.jup.ag/v6/quote";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const params = searchParams.toString();

  try {
    const res = await fetch(`${JUPITER_API}?${params}`, {
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "SolAI-PayHub/1.0",
      },
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error("Jupiter quote error:", res.status, errorBody);
      return NextResponse.json(
        { error: "No route", status: res.status, details: errorBody },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Jupiter quote error:", err);
    return NextResponse.json({ error: "No route" }, { status: 500 });
  }
}