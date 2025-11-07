'use client';

import { useState } from 'react';

export default function Home() {
  const [status, setStatus] = useState('');

  const handleTrade = async () => {
    setStatus('Submitting...');
    try {
      const res = await fetch('/api/trade-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'demo_user',
          token_mint: 'So11111111111111111111111111111111111111112',
          amount: 0.05,
          buy_price: 180,
        }),
      });
      const data = await res.json();
      setStatus(res.ok ? `Trade saved! ID: ${data.trade.id}` : `Error: ${data.error}`);
    } catch {
      setStatus('Network error');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-8">
      <div className="max-w-md mx-auto text-center">
        <h1 className="text-4xl font-bold text-blue-900 mb-2">SolAI PayHub</h1>
        <p className="text-gray-600 mb-8">Auto-trade +5% profit</p>

        <button
          onClick={handleTrade}
          className="w-full bg-green-600 text-white font-semibold py-4 rounded-xl hover:bg-green-700 transition shadow-lg"
        >
          TRADE NOW
        </button>

        {status && (
          <p className="mt-6 p-4 bg-gray-100 rounded-lg text-sm font-mono">{status}</p>
        )}

        <div className="mt-12 text-xs text-gray-500 space-y-1">
          <p>Auto-sell: +5% profit</p>
          <p>Cron: <a href="/api/cron" className="underline">/api/cron</a> (Daily 00:00 UTC)</p>
          <p>DB: Neon + Drizzle ORM</p>
        </div>
      </div>
    </main>
  );
}