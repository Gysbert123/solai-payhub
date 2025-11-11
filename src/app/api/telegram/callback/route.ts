import { NextRequest, NextResponse } from "next/server";
import { sendTradeSuccess } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const callback = body.callback_query;

    if (!callback) return NextResponse.json({ ok: true });

    const data = callback.data;
    if (data?.startsWith("TRADE_")) {
      const [_, meme] = data.split("_");
      
      const fakeTx = "5Ntciq..." + Math.random().toString(36).slice(2, 8);
      await sendTradeSuccess(
        { label: meme, profitPct: 3.2 },
        fakeTx
      );

      await fetch(`https://api.telegram.org/bot${process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callback.id })
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Callback error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}