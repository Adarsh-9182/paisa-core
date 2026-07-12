import { NextResponse } from "next/server";
import { getBrief, getMetrics, getTransactions, getRecommendations } from "@/lib/data";

/**
 * Dashboard data for the mobile app (spec 002) — the same display-ready
 * getters the web pages use, as JSON. Session-gated by the middleware.
 */
export async function GET() {
  const [brief, metrics, transactions, recommendations] = await Promise.all([
    getBrief(),
    getMetrics(),
    getTransactions(8),
    getRecommendations(),
  ]);
  return NextResponse.json({ brief, metrics, transactions, recommendations });
}
