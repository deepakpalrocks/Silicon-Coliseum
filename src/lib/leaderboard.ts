import { createServiceClient } from "./supabase-server";
import { getArenaLeaderboard } from "./arena-manager";
import type { LeaderboardEntry } from "./types";

/**
 * Leaderboard — arena-scoped and global rankings.
 */

/**
 * Get leaderboard for a specific arena.
 */
export async function calculateArenaLeaderboard(
  arenaId: string
): Promise<LeaderboardEntry[]> {
  return getArenaLeaderboard(arenaId);
}

/**
 * Calculate global leaderboard aggregating across completed arenas.
 * Ranks users by average P&L% across all their arena participations.
 */
export async function calculateGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = createServiceClient();

  // Fetch all results from completed arenas
  const { data: results, error } = await supabase
    .from("arena_results")
    .select(`
      *,
      agents(name, risk_level),
      users(username)
    `)
    .order("pnl_percent", { ascending: false });

  if (error || !results) {
    console.error("Failed to fetch global results:", error);
    return [];
  }

  // Group by agent and compute aggregate stats
  const agentMap = new Map<string, {
    agentId: string;
    agentName: string;
    ownerUsername: string;
    riskLevel: string;
    totalValue: number;
    bestPnl: number;
    avgPnl: number;
    totalTrades: number;
    arenaCount: number;
    pnlSum: number;
  }>();

  for (const result of results) {
    const agent = result.agents as unknown as { name: string; risk_level: string } | null;
    const user = result.users as unknown as { username: string } | null;
    const agentId = result.agent_id;

    const existing = agentMap.get(agentId);
    if (existing) {
      existing.arenaCount++;
      existing.pnlSum += result.pnl_percent;
      existing.avgPnl = existing.pnlSum / existing.arenaCount;
      existing.bestPnl = Math.max(existing.bestPnl, result.pnl_percent);
      existing.totalTrades += result.trade_count;
      existing.totalValue += result.final_value;
    } else {
      agentMap.set(agentId, {
        agentId,
        agentName: agent?.name || "Unknown",
        ownerUsername: user?.username || "Unknown",
        riskLevel: agent?.risk_level || "balanced",
        totalValue: result.final_value,
        bestPnl: result.pnl_percent,
        avgPnl: result.pnl_percent,
        totalTrades: result.trade_count,
        arenaCount: 1,
        pnlSum: result.pnl_percent,
      });
    }
  }

  // Convert to LeaderboardEntry and sort by avgPnl
  const entries: LeaderboardEntry[] = Array.from(agentMap.values())
    .map((a) => ({
      rank: 0,
      agentId: a.agentId,
      agentName: a.agentName,
      ownerUsername: a.ownerUsername,
      riskLevel: a.riskLevel as LeaderboardEntry["riskLevel"],
      totalValue: a.totalValue / a.arenaCount,
      pnlPercent: a.avgPnl,
      tradeCount: a.totalTrades,
      cashBalance: 0,
      totalSolBets: 0,
      totalCpBets: 0,
    }))
    .sort((a, b) => b.pnlPercent - a.pnlPercent);

  entries.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  return entries;
}
