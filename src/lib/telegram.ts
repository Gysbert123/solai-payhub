export async function sendTelegramSignal(insight: { meme: string; score: number; arb: string; risk: string }) {
  const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram not configured");
    return;
  }

  const message = `
<b>NEW AI INSIGHT</b>
Meme: <b>${insight.meme}</b>
Score: <b>${insight.score}/100</b>
Arb: ${insight.arb}
Risk: <b>${insight.risk}</b>
Cost: 0.0001 SOL
  `.trim();

  const keyboard = {
    inline_keyboard: [[
      {
        text: "TRADE NOW",
        callback_data: `TRADE_${insight.meme}_${Date.now()}`
      }
    ]]
  };

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        reply_markup: keyboard
      }),
    });
    console.log("Signal + button sent to Telegram");
  } catch (err) {
    console.error("Telegram send failed:", err);
  }
}

export async function sendTradeSuccess(trade: { label: string; profitPct: number }, tx: string) {
  const token = process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID;

  if (!token || !chatId) return;

  const message = `
<b>AUTO-TRADE SUCCESS</b>
Trade: <b>${trade.label}</b>
Profit: ${trade.profitPct >= 0 ? '+' : ''}${trade.profitPct.toFixed(2)}%
Tx: <code>${tx}</code>
You earned 0.5% fee
  `.trim();

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      }),
    });
  } catch (err) {
    console.error("Telegram send failed:", err);
  }
}