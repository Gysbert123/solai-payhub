import { NextRequest, NextResponse } from 'next/server';
import { getMarketplaceListingById, recordMarketplaceDelivery } from '@/lib/db';

const WEBHOOK_SECRET = process.env.MARKETPLACE_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers.get('x-webhook-secret');
    if (authHeader !== WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const listingId = typeof (body as any).listingId === 'string' ? (body as any).listingId : '';
  const payload =
    typeof (body as any).payload === 'string'
      ? (body as any).payload
      : JSON.stringify((body as any).payload ?? {});

  if (!listingId) {
    return NextResponse.json({ error: 'listingId required' }, { status: 400 });
  }

  const listing = await getMarketplaceListingById(listingId);
  if (!listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  }

  if (listing.status !== 'sold') {
    return NextResponse.json({ error: 'Listing not sold yet' }, { status: 409 });
  }

  const updated = await recordMarketplaceDelivery(listing.id, payload);

  return NextResponse.json(
    {
      status: 'received',
      listing: updated,
    },
    { status: 200 }
  );
}



