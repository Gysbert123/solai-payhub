import { NextResponse } from 'next/server';
import { expireMarketplaceListings, resetStaleAwaitingPaymentListings } from '@/lib/db';

export async function GET() {
  try {
    const expired = await expireMarketplaceListings();
    const reset = await resetStaleAwaitingPaymentListings();
    return NextResponse.json({
      expired,
      reset,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Marketplace expire cron failed:', error);
    return NextResponse.json({ error: 'expire failed' }, { status: 500 });
  }
}



