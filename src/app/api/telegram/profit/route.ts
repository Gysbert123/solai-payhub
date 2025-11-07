import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { profit, token, sig } = await req.json();
  const message = `
<b>PROFIT ALERT</b>
Token: <b>${token}</b>
Profit: <b>${profit} SOL</b>
Tx: <code>${sig.slice(0, 8)}...</code>
  `.trim();

  await fetch(`https://api.telegram.org/bot${process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    }),
  });

  return new Response("OK");
}