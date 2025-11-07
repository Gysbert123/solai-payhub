import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    message: 'Balance endpoint - coming soon',
    timestamp: new Date().toISOString(),
  });
}