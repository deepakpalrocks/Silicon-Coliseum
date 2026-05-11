import { SupabaseClient } from "@supabase/supabase-js";
import { calculatePrice } from "./amm";
import { resolveBets } from "./betting";
import { awardArenaReward, awardArenaParticipation } from "./points";
import type {
  Arena,
  Agent,
  Pool,
  ArenaTrade,
  LeaderboardEntry,
  ArenaResult,
} from "./types";

/**
 * Arena Manager -- lifecycle management for competitions.
 */

// ============================================================================
// Read Operations
// ============================================================================

/**
 * List arenas, optionally filtered by status.
 */
export async function getArenas(
  supabase: SupabaseClient,
  status?: string
): Promise<Arena[]> {
  let query = supabase
    .from("arenas")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list arenas: ${error.message}`);

  return (data || []).map(mapArenaRow);
}

/**
 * Get arena detail with pools, agents, and recent trades.
 */
export async function getArenaDetail(
  supabase: SupabaseClient,
  arenaId: string
): Promise<{
  arena: Arena;
  pools: Pool[];
  agents: Agent[];
  recentTrades: ArenaTrade[];
}> {
  // Fetch arena
  const { data: arenaRow, error: arenaError } = await supabase
    .from("arenas")
    .select("*")
    .eq("id", arenaId)
    .single();

  if (arenaError || !arenaRow)
    throw new Error(`Arena not found: ${arenaError?.message}`);

  const arena = mapArenaRow(arenaRow);

  // Fetch pools
  const { data: poolRows } = await supabase
    .from("pools")
    .select("*")
    .eq("arena_id", arenaId);

  const pools: Pool[] = (poolRows || []).map(mapPoolRow);

  // Fetch agents via arena_entries (persistent agents model)
  const { data: entryRows } = await supabase
    .from("arena_entries")
    .select("*, agents(*)")
    .eq("arena_id", arenaId);

  let agents: Agent[] = [];
  if (entryRows && entryRows.length > 0) {
    agents = entryRows.map((entry) => {
      const a = entry.agents as Record<string, unknown>;
      return mapAgentRow({
        ...a,
        arena_id: arenaId,
        cash_balance: entry.cash_balance,
        status: entry.status,
      });
    });
  } else {
    // Fallback: old-style agents with arena_id set directly
    const { data: agentRows } = await supabase
      .from("agents")
      .select("*")
      .eq("arena_id", arenaId);
    agents = (agentRows || []).map(mapAgentRow);
  }

  // Fetch recent trades (last 50)
  const { data: tradeRows } = await supabase
    .from("arena_trades")
    .select("*")
    .eq("arena_id", arenaId)
    .order("created_at", { ascending: false })
    .limit(50);

  const recentTrades: ArenaTrade[] = (tradeRows || []).map(mapTradeRow);

  return { arena, pools, agents, recentTrades };
}

// ============================================================================
// Arena Entry
// ============================================================================

/**
 * Enter an arena with an agent.
 * If agentId is provided, reuse an existing persistent agent.
 * Otherwise, create a new agent.
 */
export async function enterArena(
  supabase: SupabaseClient,
  arenaId: string,
  userId: string,
  agentConfig: {
    name: string;
    riskLevel: string;
    strategyDescription?: string;
    agentId?: string;
    avatarUrl?: string;
    payoutWallet?: string;
  }
): Promise<Agent> {
  // Fetch arena
  const { data: arenaRow, error: arenaError } = await supabase
    .from("arenas")
    .select("*")
    .eq("id", arenaId)
    .single();

  if (arenaError || !arenaRow) throw new Error("Arena not found");

  const arena = mapArenaRow(arenaRow);

  // Validate arena status
  if (arena.status !== "upcoming" && arena.status !== "active") {
    throw new Error("Arena is not accepting new agents");
  }

  // Check agent count via arena_entries
  const { count: entryCount } = await supabase
    .from("arena_entries")
    .select("*", { count: "exact", head: true })
    .eq("arena_id", arenaId);

  // Fallback: also check agents table for backward compat
  const { count: agentCount } = await supabase
    .from("agents")
    .select("*", { count: "exact", head: true })
    .eq("arena_id", arenaId);

  const totalCount = Math.max(entryCount || 0, agentCount || 0);
  if (totalCount >= arena.maxAgents) {
    throw new Error("Arena is full");
  }

  let agent;

  if (agentConfig.agentId) {
    // Reuse existing agent
    const { data: existingAgent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentConfig.agentId)
      .eq("user_id", userId)
      .single();

    if (agentError || !existingAgent) throw new Error("Agent not found");

    // Check agent isn't already in an active arena
    const { data: activeEntry } = await supabase
      .from("arena_entries")
      .select("id")
      .eq("agent_id", agentConfig.agentId)
      .eq("status", "active")
      .maybeSingle();

    if (activeEntry) {
      throw new Error("This agent is already in an active arena");
    }

    // Update agent to point to this arena and reset cash
    const agentUpdate: Record<string, unknown> = {
      arena_id: arenaId,
      cash_balance: arena.startingBalance,
      status: "active",
    };
    if (agentConfig.payoutWallet) {
      agentUpdate.payout_wallet = agentConfig.payoutWallet;
    }
    await supabase
      .from("agents")
      .update(agentUpdate)
      .eq("id", agentConfig.agentId);

    agent = { ...existingAgent, arena_id: arenaId, cash_balance: arena.startingBalance, status: "active" };
  } else {
    // Check user doesn't already have an agent with same name
    const { data: existingAgent } = await supabase
      .from("arena_entries")
      .select("agent_id, agents!inner(user_id)")
      .eq("arena_id", arenaId)
      .eq("agents.user_id", userId)
      .maybeSingle();

    if (existingAgent) {
      throw new Error("You already have an agent in this arena");
    }

    // Create new agent
    const { data: agentRow, error: agentError } = await supabase
      .from("agents")
      .insert({
        user_id: userId,
        arena_id: arenaId,
        name: agentConfig.name,
        risk_level: agentConfig.riskLevel,
        strategy_description: agentConfig.strategyDescription || null,
        avatar_url: agentConfig.avatarUrl || null,
        payout_wallet: agentConfig.payoutWallet || null,
        cash_balance: arena.startingBalance,
        status: "active",
      })
      .select()
      .single();

    if (agentError) throw new Error(`Failed to create agent: ${agentError.message}`);
    agent = agentRow;
  }

  // Create arena_entries record
  await supabase.from("arena_entries").insert({
    arena_id: arenaId,
    agent_id: agent.id,
    cash_balance: arena.startingBalance,
    status: "active",
  });

  // Award participation CP
  try {
    await awardArenaParticipation(supabase, userId, arenaId);
  } catch {
    // Non-fatal
  }

  return mapAgentRow(agent);
}

// ============================================================================
// Leaderboard
// ============================================================================

/**
 * Calculate leaderboard for an arena.
 * Portfolio value = sum(token_holdings * pool_price) + cash_balance
 */
export async function calculateLeaderboard(
  supabase: SupabaseClient,
  arenaId: string
): Promise<LeaderboardEntry[]> {
  // Fetch arena
  const { data: arenaRow } = await supabase
    .from("arenas")
    .select("starting_balance")
    .eq("id", arenaId)
    .single();

  const startingBalance = arenaRow?.starting_balance || 10000;

  // Fetch agents via arena_entries (persistent agents model)
  const { data: entryRows } = await supabase
    .from("arena_entries")
    .select("*, agents(*, users(username))")
    .eq("arena_id", arenaId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentRows: any[] = [];
  if (entryRows && entryRows.length > 0) {
    agentRows = entryRows.map((entry) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = entry.agents as any;
      return {
        ...a,
        arena_id: arenaId,
        cash_balance: entry.cash_balance,
        status: entry.status,
      };
    });
  } else {
    // Fallback to old model
    const { data: oldRows } = await supabase
      .from("agents")
      .select("*, users(username)")
      .eq("arena_id", arenaId);
    agentRows = oldRows || [];
  }

  if (agentRows.length === 0) return [];

  // Fetch all pools for this arena
  const { data: poolRows } = await supabase
    .from("pools")
    .select("*")
    .eq("arena_id", arenaId);

  const pools = poolRows || [];

  // Fetch all arena balances
  const { data: balanceRows } = await supabase
    .from("arena_balances")
    .select("*")
    .eq("arena_id", arenaId);

  const balances = balanceRows || [];

  // Fetch trade counts per agent
  const { data: tradeRows } = await supabase
    .from("arena_trades")
    .select("agent_id")
    .eq("arena_id", arenaId);

  const tradeCountMap = new Map<string, number>();
  if (tradeRows) {
    for (const t of tradeRows) {
      tradeCountMap.set(t.agent_id, (tradeCountMap.get(t.agent_id) || 0) + 1);
    }
  }

  // Fetch bet totals per agent
  const { data: betRows } = await supabase
    .from("bets")
    .select("agent_id, sol_amount, cp_amount, bet_currency")
    .eq("arena_id", arenaId);

  const solBetMap = new Map<string, number>();
  const cpBetMap = new Map<string, number>();
  if (betRows) {
    for (const b of betRows) {
      if (b.bet_currency === "sol") {
        solBetMap.set(b.agent_id, (solBetMap.get(b.agent_id) || 0) + (b.sol_amount || 0));
      } else {
        cpBetMap.set(b.agent_id, (cpBetMap.get(b.agent_id) || 0) + (b.cp_amount || 0));
      }
    }
  }

  // Calculate portfolio value for each agent
  const entries: LeaderboardEntry[] = agentRows.map((row) => {
    const agentBalances = balances.filter((b) => b.agent_id === row.id);

    let holdingsValue = 0;
    for (const bal of agentBalances) {
      if (bal.amount <= 0) continue;

      // Find pool for this token to get its vUSD price
      const pool = pools.find(
        (p) => p.token_id === bal.token_id || p.base_token_id === bal.token_id
      );

      if (pool && pool.reserve_token > 0 && pool.reserve_base > 0) {
        if (pool.token_id === bal.token_id) {
          // This is the non-base token -- price it using the pool
          const price = calculatePrice(pool.reserve_token, pool.reserve_base);
          holdingsValue += bal.amount * price;
        } else {
          // This is the base token in a balance -- face value
          holdingsValue += bal.amount;
        }
      }
    }

    const cashBalance = row.cash_balance || 0;
    const totalValue = cashBalance + holdingsValue;
    const pnlPercent =
      startingBalance > 0
        ? ((totalValue - startingBalance) / startingBalance) * 100
        : 0;

    const user = row.users as unknown as { username: string } | null;

    return {
      rank: 0,
      agentId: row.id,
      agentName: row.name || "Unknown",
      ownerUsername: user?.username || "Unknown",
      riskLevel: row.risk_level || "balanced",
      totalValue,
      pnlPercent,
      tradeCount: tradeCountMap.get(row.id) || 0,
      cashBalance,
      totalSolBets: solBetMap.get(row.id) || 0,
      totalCpBets: cpBetMap.get(row.id) || 0,
    };
  });

  // Sort by total value descending
  entries.sort((a, b) => b.totalValue - a.totalValue);
  entries.forEach((entry, i) => {
    entry.rank = i + 1;
  });

  return entries;
}

// ============================================================================
// Arena Finalization
// ============================================================================

/**
 * Finalize a completed arena:
 * 1. Compute rankings by total portfolio value
 * 2. Create arena_results records
 * 3. Award CP to top 10 agent owners
 * 4. Resolve bets
 * 5. Update user_profiles
 */
export async function finalizeArena(
  supabase: SupabaseClient,
  arenaId: string
): Promise<void> {
  // Calculate final leaderboard
  const leaderboard = await calculateLeaderboard(supabase, arenaId);

  if (leaderboard.length === 0) return;

  // Fetch arena for starting balance
  const { data: arenaRow } = await supabase
    .from("arenas")
    .select("starting_balance")
    .eq("id", arenaId)
    .single();

  const startingBalance = arenaRow?.starting_balance || 10000;

  // Create arena_results and award CP for each agent
  const topAgentIds: string[] = [];

  for (const entry of leaderboard) {
    topAgentIds.push(entry.agentId);

    // Look up user_id for this agent
    const { data: agent } = await supabase
      .from("agents")
      .select("user_id")
      .eq("id", entry.agentId)
      .single();

    const userId = agent?.user_id || "";

    // Determine CP reward
    let rewardCp = 0;
    if (entry.rank === 1) rewardCp = 50;
    else if (entry.rank === 2) rewardCp = 35;
    else if (entry.rank === 3) rewardCp = 25;
    else if (entry.rank >= 4 && entry.rank <= 10) rewardCp = 10;

    // Insert arena result
    await supabase.from("arena_results").insert({
      arena_id: arenaId,
      agent_id: entry.agentId,
      user_id: userId,
      final_rank: entry.rank,
      final_value: entry.totalValue,
      pnl_percent: entry.pnlPercent,
      reward_cp: rewardCp,
      trade_count: entry.tradeCount,
    });

    // Award CP
    if (rewardCp > 0 && userId) {
      try {
        await awardArenaReward(supabase, userId, arenaId, entry.rank);
      } catch {
        // Non-fatal
      }
    }

    // Update user profile
    if (userId) {
      await updateUserProfile(supabase, userId, entry, startingBalance);
    }
  }

  // Resolve bets
  try {
    await resolveBets(supabase, arenaId, topAgentIds);
  } catch {
    // Non-fatal
  }

  // Update arena_entries status to finished
  await supabase
    .from("arena_entries")
    .update({ status: "finished" })
    .eq("arena_id", arenaId);

  // Update agent stats (total_arenas, total_wins, best_pnl)
  for (const entry of leaderboard) {
    const { data: agentRow } = await supabase
      .from("agents")
      .select("total_arenas, total_wins, best_pnl")
      .eq("id", entry.agentId)
      .single();

    if (agentRow) {
      await supabase
        .from("agents")
        .update({
          total_arenas: (agentRow.total_arenas || 0) + 1,
          total_wins: entry.rank === 1 ? (agentRow.total_wins || 0) + 1 : (agentRow.total_wins || 0),
          best_pnl: Math.max(agentRow.best_pnl || 0, entry.pnlPercent),
          status: "finished",
        })
        .eq("id", entry.agentId);
    }

    // Update arena_entries with final cash balance
    await supabase
      .from("arena_entries")
      .update({ cash_balance: entry.cashBalance, status: "finished" })
      .eq("arena_id", arenaId)
      .eq("agent_id", entry.agentId);
  }

  // Mark arena as completed
  await supabase
    .from("arenas")
    .update({ status: "completed" })
    .eq("id", arenaId);
}

// ============================================================================
// Helpers
// ============================================================================

async function updateUserProfile(
  supabase: SupabaseClient,
  userId: string,
  entry: LeaderboardEntry,
  startingBalance: number
): Promise<void> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile) {
    await supabase
      .from("user_profiles")
      .update({
        total_arenas: profile.total_arenas + 1,
        wins: entry.rank === 1 ? profile.wins + 1 : profile.wins,
        top3_finishes:
          entry.rank <= 3
            ? profile.top3_finishes + 1
            : profile.top3_finishes,
        best_pnl: Math.max(profile.best_pnl, entry.pnlPercent),
        total_trades: profile.total_trades + entry.tradeCount,
      })
      .eq("user_id", userId);
  } else {
    await supabase.from("user_profiles").insert({
      user_id: userId,
      total_arenas: 1,
      wins: entry.rank === 1 ? 1 : 0,
      top3_finishes: entry.rank <= 3 ? 1 : 0,
      best_pnl: entry.pnlPercent,
      total_trades: entry.tradeCount,
    });
  }
}

/** Map a DB row to the Arena interface */
function mapArenaRow(row: Record<string, unknown>): Arena {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) || null,
    status: row.status as Arena["status"],
    startingBalance: (row.starting_balance as number) || 10000,
    maxAgents: (row.max_agents as number) || 20,
    decayRate: (row.decay_rate as number) || 0.001,
    competitionStart: (row.competition_start as string) || null,
    competitionEnd: (row.competition_end as string) || null,
    bettingPhaseEnd: (row.betting_phase_end as string) || null,
    betType: (row.bet_type as Arena["betType"]) || "both",
    createdBy: (row.created_by as string) || null,
    createdAt: row.created_at as string,
  };
}

/** Map a DB row to the Pool interface */
function mapPoolRow(row: Record<string, unknown>): Pool {
  return {
    id: row.id as string,
    arenaId: row.arena_id as string,
    tokenId: row.token_id as string,
    baseTokenId: row.base_token_id as string,
    reserveToken: (row.reserve_token as number) || 0,
    reserveBase: (row.reserve_base as number) || 0,
    feeRate: (row.fee_rate as number) || 0.003,
    totalVolume: (row.total_volume as number) || 0,
  };
}

/** Map a DB row to the Agent interface */
function mapAgentRow(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    arenaId: (row.arena_id as string) || null,
    name: row.name as string,
    riskLevel: (row.risk_level as Agent["riskLevel"]) || "balanced",
    strategyDescription: (row.strategy_description as string) || null,
    avatarUrl: (row.avatar_url as string) || null,
    cashBalance: (row.cash_balance as number) || 0,
    status: (row.status as Agent["status"]) || "active",
    totalArenas: (row.total_arenas as number) || 0,
    totalWins: (row.total_wins as number) || 0,
    bestPnl: (row.best_pnl as number) || 0,
    createdAt: row.created_at as string,
  };
}

/** Map a DB row to the ArenaTrade interface */
function mapTradeRow(row: Record<string, unknown>): ArenaTrade {
  return {
    id: row.id as string,
    arenaId: row.arena_id as string,
    poolId: row.pool_id as string,
    agentId: row.agent_id as string,
    action: row.action as ArenaTrade["action"],
    tokenId: row.token_id as string,
    amountIn: (row.amount_in as number) || 0,
    amountOut: (row.amount_out as number) || 0,
    price: (row.price as number) || 0,
    fee: (row.fee as number) || 0,
    reasoning: (row.reasoning as string) || null,
    createdAt: row.created_at as string,
  };
}

// ============================================================================
// Legacy exports (backward compatibility for existing code)
// ============================================================================
import { createServiceClient } from "./supabase-server";
import type {
  ArenaPhase,
  ArenaEntry,
  ArenaBalance as LegacyArenaBalance,
} from "./types";

// Re-export legacy types used by existing imports
export type { ArenaPhase, ArenaEntry };

/** @deprecated Use getArenas instead */
export async function listArenas(status?: string) {
  const sb = createServiceClient();
  return getArenas(sb, status);
}

/** @deprecated Use getArenaDetail instead */
export async function getArena(arenaId: string) {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("arenas")
    .select("*")
    .eq("id", arenaId)
    .single();
  if (error) throw new Error(`Arena not found: ${error.message}`);
  return data;
}

/** @deprecated Legacy createArena */
export async function createArena(params: {
  name: string;
  description?: string;
  entry_fee?: number;
  prize_pool?: number;
  starting_balance?: number;
  max_agents_per_user?: number;
  competition_start?: string;
  competition_end?: string;
  challenge_end?: string;
  decay_rate?: number;
  created_by?: string;
}) {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("arenas")
    .insert({
      name: params.name,
      description: params.description || null,
      status: "upcoming",
      starting_balance: params.starting_balance ?? 10000,
      max_agents: 20,
      decay_rate: params.decay_rate ?? 0.001,
      competition_start: params.competition_start || null,
      competition_end: params.competition_end || null,
      created_by: params.created_by || null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create arena: ${error.message}`);
  return data;
}

/** @deprecated Legacy phase transition */
export async function transitionPhase(arenaId: string, newPhase: ArenaPhase) {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("arenas")
    .update({ status: newPhase === "closed" ? "completed" : "active" })
    .eq("id", arenaId)
    .select()
    .single();
  if (error) throw new Error(`Failed to transition: ${error.message}`);
  return data;
}

/** @deprecated Legacy joinArena */
export async function joinArena(
  arenaId: string,
  agentId: string,
  userId: string,
  isNpc: boolean = false
) {
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("arena_entries")
    .insert({
      arena_id: arenaId,
      agent_id: agentId,
      user_id: userId,
      is_npc: isNpc,
      status: "registered",
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to join arena: ${error.message}`);
  return data;
}

/** @deprecated Legacy calculateAgentValue */
export async function calculateAgentValue(arenaId: string, agentId: string) {
  const sb = createServiceClient();
  const { data: balances } = await sb
    .from("arena_balances")
    .select("*")
    .eq("arena_id", arenaId)
    .eq("agent_id", agentId);
  return { totalValue: 0, balances: (balances || []) as LegacyArenaBalance[] };
}

/** @deprecated Use calculateLeaderboard instead */
export async function getArenaLeaderboard(arenaId: string): Promise<LeaderboardEntry[]> {
  const sb = createServiceClient();
  return calculateLeaderboard(sb, arenaId);
}

/** @deprecated Legacy distributeRewards */
export async function distributeRewards(arenaId: string) {
  const sb = createServiceClient();
  await finalizeArena(sb, arenaId);
  return [];
}

/** @deprecated Legacy checkPhaseTransitions */
export async function checkPhaseTransitions(): Promise<void> {
  // No-op in new model -- cron handles this
}
