import { NextRequest, NextResponse } from 'next/server';
import { fetchWithFallback } from '@/lib/rpc-fallback';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Extract method and params from the RPC request
    const { method, params = [] } = body;

    if (!method) {
      return NextResponse.json(
        { error: 'Missing method in RPC request' },
        { status: 400 }
      );
    }

    // Use fallback system
    const data = await fetchWithFallback(method, params);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('RPC proxy error:', error);
    return NextResponse.json(
      { 
        error: 'RPC proxy failed', 
        message: error.message,
        hint: 'All RPC endpoints are rate-limited. Consider upgrading your RPC plan.'
      },
      { status: 500 }
    );
  }
}


