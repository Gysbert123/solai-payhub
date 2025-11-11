import { NextRequest, NextResponse } from 'next/server';
import { listRecentArbs } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 50) : 10;

    const rows = await listRecentArbs(limit);
    return NextResponse.json({ arbs: rows });
  } catch (error) {
    console.error('Failed to fetch arbs:', error);
    return NextResponse.json({ arbs: [] }, { status: 500 });
  }
}

