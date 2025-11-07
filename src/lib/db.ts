import { NextRequest, NextResponse } from 'next/server';
import { savePosition } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { userWallet, tokenMint, buyAmount, entrySol } = await req.json();

    await savePosition(userWallet, tokenMint, buyAmount, entrySol);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}