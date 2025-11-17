import { NextRequest, NextResponse } from "next/server";
import { watchSignature } from "@/lib/txWatcher";

export async function POST(request: NextRequest) {
  try {
    const { signature } = await request.json();
    if (!signature || typeof signature !== "string") {
      return NextResponse.json({ error: "signature required" }, { status: 400 });
    }

    watchSignature(signature);

    return NextResponse.json({ watching: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Invalid payload" }, { status: 400 });
  }
}

