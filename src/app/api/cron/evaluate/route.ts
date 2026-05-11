import { NextResponse, NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { applyDrift, applyCashDecay, getRealPriceTargets } from "@/lib/drift";
import { calculatePrice } from "@/lib/amm";
import { evaluateAllAgents } from "@/lib/agent-engine";
import { executeBuy, executeSell } from "@/lib/trade-executor";
import type { Pool, Agent, ArenaTrade } from "@/lib/types";

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  try {
    // Verify authorization: CRON_SECRET or admin user
    const cronSecret = request.headers.get("x-cron-secret") ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    const isCronAuth = process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

    if (!isCronAuth) {
      // Check if request is from an admin user
      const { getSession } = await import("@/lib/auth");
      const session = await getSession(request);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const supabaseAuth = createServiceClient();
      const { data: adminUser } = await supabaseAuth
        .from("users")
        .select("is_admin")
        .eq("id", session.userId)
        .maybeSingle();
      if (!adminUser?.is_admin) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
    }

    const supabase = createServiceClient();

    // Fetch all active arenas
    const { data: arenas } = await supabase
      .from("arenas")
      .select("*")
      .eq("status", "active");

    if (!arenas || arenas.length === 0) {
      return NextResponse.json({
        message: "No active arenas",
        summary: { arenasProcessed: 0 },
      });
    }

    const summary = {
      arenasProcessed: 0,
      driftsApplied: 0,
      decaysApplied: 0,
      agentsEvaluated: 0,
      tradesExecuted: 0,
      snapshotsTaken: 0,
      errors: [] as string[],
    };

    for (const arenaRow of arenas) {
      try {
        summary.arenasProcessed++;
        const arenaId = arenaRow.id;
        const decayRate = arenaRow.decay_rate || 0.001;

        // 1. Fetch all pools for this arena
        const { data: poolRows } = await supabase
          .from("pools")
          .select("*")
          .eq("arena_id", arenaId);

        const pools: Pool[] = (poolRows || []).map((p) => ({
          id: p.id,
          arenaId: p.arena_id,
          tokenId: p.token_id,
          baseTokenId: p.base_token_id,
          reserveToken: p.reserve_token,
          reserveBase: p.reserve_base,
          feeRate: p.fee_rate,
          totalVolume: p.total_volume,
        }));

        // 2. Fetch real price targets and apply targeted drift
        const realPriceTargets = await getRealPriceTargets();

        // Build tokenId -> symbol map for price lookup
        const { data: allTokenRows } = await supabase
          .from("platform_tokens")
          .select("id, symbol");
        const tokenIdToSymbol = new Map<string, string>();
        if (allTokenRows) {
          for (const t of allTokenRows) {
            tokenIdToSymbol.set(t.id, t.symbol);
          }
        }

        for (const pool of pools) {
          const tokenSymbol = tokenIdToSymbol.get(pool.tokenId);
          const targetPrice = tokenSymbol ? realPriceTargets.get(tokenSymbol) : undefined;

          const drifted = applyDrift(pool.reserveToken, pool.reserveBase, targetPrice);

          await supabase
            .from("pools")
            .update({
              reserve_token: drifted.reserveToken,
              reserve_base: drifted.reserveBase,
            })
            .eq("id", pool.id);

          // Update in-memory pool values for agent evaluation
          pool.reserveToken = drifted.reserveToken;
          pool.reserveBase = drifted.reserveBase;

          summary.driftsApplied++;
        }

        // 3. Fetch all active agents via arena_entries and apply cash decay
        const { data: entryRows } = await supabase
          .from("arena_entries")
          .select("*, agents(*)")
          .eq("arena_id", arenaId)
          .eq("status", "active");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agents: Agent[] = (entryRows || []).map((entry: any) => {
          const a = entry.agents;
          return {
            id: a.id,
            userId: a.user_id,
            arenaId: arenaId,
            name: a.name,
            riskLevel: a.risk_level || "balanced",
            strategyDescription: a.strategy_description || null,
            avatarUrl: a.avatar_url || null,
            cashBalance: entry.cash_balance || 0,
            status: entry.status || "active",
            totalArenas: a.total_arenas || 0,
            totalWins: a.total_wins || 0,
            bestPnl: a.best_pnl || 0,
            createdAt: a.created_at,
          };
        });

        for (const agent of agents) {
          const decayedBalance = applyCashDecay(agent.cashBalance, decayRate);

          // Update cash_balance on arena_entries (not agents table)
          await supabase
            .from("arena_entries")
            .update({ cash_balance: decayedBalance })
            .eq("arena_id", arenaId)
            .eq("agent_id", agent.id);

          agent.cashBalance = decayedBalance;
          summary.decaysApplied++;
        }

        // 3b. Skip agent trading if still in betting phase
        const bettingPhaseEnd = arenaRow.betting_phase_end
          ? new Date(arenaRow.betting_phase_end)
          : null;
        if (bettingPhaseEnd && bettingPhaseEnd > new Date()) {
          // Still in betting phase — apply drift/decay but don't let agents trade
          continue;
        }

        // 4. Compute pool prices
        const poolPrices = new Map<string, number>();
        for (const pool of pools) {
          try {
            poolPrices.set(
              pool.id,
              calculatePrice(pool.reserveToken, pool.reserveBase)
            );
          } catch {
            poolPrices.set(pool.id, 0);
          }
        }

        // 5. Fetch recent trades for context
        const { data: recentTradeRows } = await supabase
          .from("arena_trades")
          .select("*")
          .eq("arena_id", arenaId)
          .order("created_at", { ascending: false })
          .limit(50);

        const recentTrades: ArenaTrade[] = (recentTradeRows || []).map((t) => ({
          id: t.id,
          arenaId: t.arena_id,
          poolId: t.pool_id,
          agentId: t.agent_id,
          action: t.action,
          tokenId: t.token_id,
          amountIn: t.amount_in || 0,
          amountOut: t.amount_out || 0,
          price: t.price || 0,
          fee: t.fee || 0,
          reasoning: t.reasoning || null,
          createdAt: t.created_at,
        }));

        // Fetch token symbol map
        const tokenIds = new Set<string>();
        for (const pool of pools) {
          tokenIds.add(pool.tokenId);
          tokenIds.add(pool.baseTokenId);
        }

        const { data: tokenRows } = await supabase
          .from("platform_tokens")
          .select("id, symbol")
          .in("id", Array.from(tokenIds));

        const tokenSymbolMap = new Map<string, string>();
        if (tokenRows) {
          for (const t of tokenRows) {
            tokenSymbolMap.set(t.id, t.symbol);
          }
        }

        // Reverse map: symbol -> tokenId
        const symbolToTokenId = new Map<string, string>();
        for (const [id, symbol] of tokenSymbolMap) {
          symbolToTokenId.set(symbol, id);
        }

        // 6. Batch evaluate ALL agents in a single Cerebras prompt
        // Fetch holdings for all agents
        const agentContexts = await Promise.all(
          agents.map(async (agent) => {
            const { data: balances } = await supabase
              .from("arena_balances")
              .select("*, platform_tokens(symbol)")
              .eq("arena_id", arenaId)
              .eq("agent_id", agent.id);

            const holdings = (balances || [])
              .filter((b) => b.amount > 0)
              .map((b) => ({
                symbol: b.platform_tokens?.symbol || tokenSymbolMap.get(b.token_id) || "?",
                amount: b.amount as number,
              }));

            return { agent, holdings };
          })
        );

        const batchDecisions = await evaluateAllAgents(
          agentContexts,
          pools,
          poolPrices,
          recentTrades,
          tokenSymbolMap
        );

        summary.agentsEvaluated += agents.length;

        // Execute trades with staggered timing (1-2s between agents)
        for (const agent of agents) {
          const decision = batchDecisions.get(agent.name);
          if (!decision || decision.actions.length === 0) continue;

          // Stagger: wait 1000-2000ms between each agent's trades
          const delay = 1000 + Math.floor(Math.random() * 1000);
          await new Promise((r) => setTimeout(r, delay));

          for (const action of decision.actions) {
            if (action.action === "HOLD") continue;

            const tokenId = symbolToTokenId.get(action.tokenSymbol);
            if (!tokenId) continue;

            const pool = pools.find((p) => p.tokenId === tokenId);
            if (!pool) continue;

            try {
              if (action.action === "BUY" && action.amountVusd > 0) {
                await executeBuy(
                  supabase,
                  arenaId,
                  agent.id,
                  pool.id,
                  Math.min(action.amountVusd, agent.cashBalance)
                );
                summary.tradesExecuted++;
              } else if (action.action === "SELL" && action.amountVusd > 0) {
                const price = poolPrices.get(pool.id) || 1;
                const tokenAmount = action.amountVusd / price;

                const { data: balance } = await supabase
                  .from("arena_balances")
                  .select("amount")
                  .eq("arena_id", arenaId)
                  .eq("agent_id", agent.id)
                  .eq("token_id", tokenId)
                  .maybeSingle();

                if (balance && balance.amount > 0) {
                  const sellAmount = Math.min(tokenAmount, balance.amount);
                  await executeSell(
                    supabase,
                    arenaId,
                    agent.id,
                    pool.id,
                    sellAmount
                  );
                  summary.tradesExecuted++;
                }
              }
            } catch (tradeError) {
              console.error(`Trade failed for agent ${agent.name}:`, tradeError);
            }
          }
        }

        // 7. Take pool snapshots
        for (const pool of pools) {
          // Re-fetch pool for latest reserves after trades
          const { data: latestPool } = await supabase
            .from("pools")
            .select("*")
            .eq("id", pool.id)
            .single();

          if (latestPool) {
            let snapshotPrice = 0;
            try {
              snapshotPrice = calculatePrice(
                latestPool.reserve_token,
                latestPool.reserve_base
              );
            } catch {
              // Invalid reserves
            }

            await supabase.from("pool_snapshots").insert({
              pool_id: pool.id,
              price: snapshotPrice,
              reserve_token: latestPool.reserve_token,
              reserve_base: latestPool.reserve_base,
              volume: latestPool.total_volume,
            });

            summary.snapshotsTaken++;
          }
        }
      } catch (arenaError) {
        console.error(`Arena processing failed for ${arenaRow.id}:`, arenaError);
        summary.errors.push(
          `Arena ${arenaRow.id}: ${arenaError instanceof Error ? arenaError.message : "unknown error"}`
        );
      }
    }

    return NextResponse.json({
      message: "Evaluation cycle complete",
      summary,
    });
  } catch (error) {
    console.error("Cron evaluate failed:", error);
    return NextResponse.json(
      { error: "Evaluation cycle failed" },
      { status: 500 }
    );
  }
}
