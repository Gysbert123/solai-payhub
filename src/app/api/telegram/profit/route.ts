import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { profit, token, sig, amount } = await req.json();

    const message = `
<b>PROFIT UPDATE</b>
Token: <b>${token}</b>
Holding: <b>${amount} tokens</b>
PnL: <b>$${profit}</b>
Tx: <a href="https://solscan.io/tx/${sig}">${sig.slice(0, 8)}...</a>
    `.trim();

    await fetch(`https://api.telegram.org/bot${process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    return new Response("OK");
  } catch (err) {
    console.error("Profit notification failed:", err);
    return new Response("Error", { status: 500 });
  }
}