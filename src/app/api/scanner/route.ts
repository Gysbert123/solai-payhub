import { NextResponse } from "next/server";

export async function GET() {
  const arbs = [
    {
      id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyK7fDi", // USDC
      name: "USDC",
      from: "Jupiter",
      to: "Orca",
      profit: 0.05,
      risk: "Low" as const,
      ai_score: 98,
      updated: new Date().toISOString(),
    },
  ];

  return NextResponse.json({ arbs });
}