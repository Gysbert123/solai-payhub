import { NextResponse } from 'next/server';
import { getAgentRevenueSummary, listRecentAgentPayments } from '@/lib/db';

export async function GET() {
  const summary = await getAgentRevenueSummary();
  const recent = await listRecentAgentPayments(5);

  return NextResponse.json({
    summary,
    recent: recent.map((payment) => ({
      id: payment.id,
      agentId: payment.agent_id,
      amount: payment.amount,
      status: payment.status,
      signature: payment.tx_signature,
      insight: payment.insight_json ? JSON.parse(payment.insight_json) : null,
      confirmedAt: payment.confirmed_at,
      deliveredAt: payment.delivered_at,
      createdAt: payment.created_at,
    })),
  });
}
