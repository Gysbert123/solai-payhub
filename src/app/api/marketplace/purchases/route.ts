import { NextRequest, NextResponse } from 'next/server';
import { getPurchasedListingsByWallet } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const buyerWallet = searchParams.get('wallet');

  if (!buyerWallet) {
    return NextResponse.json({ error: 'wallet parameter is required' }, { status: 400 });
  }

  try {
    const listings = await getPurchasedListingsByWallet(buyerWallet, 50);
    
    return NextResponse.json(
      { listings },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    console.error('Failed to fetch purchased listings:', error);
    return NextResponse.json({ error: 'Failed to fetch purchased listings' }, { status: 500 });
  }
}

