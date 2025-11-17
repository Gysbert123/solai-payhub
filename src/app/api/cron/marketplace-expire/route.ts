import { NextResponse } from 'next/server';
import { expireMarketplaceListings } from '@/lib/db';

export async function GET() {
  try {
    const expired = await expireMarketplaceListings();
    return NextResponse.json({
      expired,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Marketplace expire cron failed:', error);
    return NextResponse.json({ error: 'expire failed' }, { status: 500 });
  }
}



