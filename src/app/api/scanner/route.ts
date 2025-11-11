import { NextResponse } from "next/server";
import { listRecentArbs } from "@/lib/db";

export async function GET() {
  try {
    const arbs = await listRecentArbs(10);
    return NextResponse.json({ arbs });
  } catch (error) {
    console.error("Scanner route error:", error);
    return NextResponse.json({ arbs: [] }, { status: 500 });
  }
}