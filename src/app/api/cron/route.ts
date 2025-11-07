import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ 
    status: "OK",
    message: "Auto-sell endpoint is live",
    cron: "Daily at 00:00 UTC (Hobby plan)",
    path: "/api/cron",
    timestamp: new Date().toISOString()
  });
}