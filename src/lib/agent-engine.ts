import OpenAI from "openai";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import type {
  Agent,
  Pool,
  ArenaTrade,
  AIDecision,
  AIAction,
} from "./types";
import { calculatePrice } from "./amm";
import { getCelebrityPrompt } from "./celebrity-agents";

/**
 * AI Agent Decision Engine -- uses Cerebras via OpenAI-compatible SDK.
 * Batch evaluates ALL agents in a single prompt for efficiency.
 * Celebrity agents get personality-driven decisions!
 */

const cerebras = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "",
});

const RISK_PROFILES: Record<Agent["riskLevel"], string> = {
  conservative:
    "Focus on smaller positions (5-15% of balance), high confidence threshold (0.7+). Only trade when signals are very strong. Prefer preservation of capital.",
  balanced:
    "Moderate positions (10-25%), medium confidence (0.5+). Balance risk and reward across multiple tokens.",
  aggressive:
    "Larger positions (15-40%), lower confidence (0.3+). Trade frequently on momentum signals.",
  degen:
    "Massive positions (up to 50%), trade on any signal. YOLO mentality. Chase the biggest movers.",
};

// ============================================================================
// Zod Schemas
// ============================================================================

const AIActionSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  tokenSymbol: z.string(),
  amountVusd: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const AIDecisionSchema = z.object({
  actions: z.array(AIActionSchema),
});

// ============================================================================
// Batch evaluation - single prompt for ALL agents
// ============================================================================

interface AgentContext {
  agent: Agent;
  holdings: Array<{ symbol: string; amount: number }>;
}

/**
 * Evaluate ALL agents in a single Cerebras prompt.
 * Returns a map of agentName -> AIDecision.
 */
export async function evaluateAllAgents(
  agents: AgentContext[],
  pools: Pool[],
  poolPrices: Map<string, number>,
  recentTrades: ArenaTrade[],
  tokenSymbolMap: Map<string, string>
): Promise<Map<string, AIDecision>> {
  const results = new Map<string, AIDecision>();

  if (agents.length === 0) return results;

  try {
    // Build pool info
    const poolsText = pools
      .map((p) => {
        const tokenSymbol = tokenSymbolMap.get(p.tokenId) || "?";
        const price = poolPrices.get(p.id) || calculatePrice(p.reserveToken, p.reserveBase);
        return `  ${tokenSymbol}/vUSD: $${price.toFixed(4)} | Reserves: ${p.reserveToken.toFixed(1)}/${p.reserveBase.toFixed(1)}`;
      })
      .join("\n");

    const availableTokens = pools.map((p) => tokenSymbolMap.get(p.tokenId) || "?").join(", ");

    // Build recent trades summary
    const tradesText = recentTrades.length > 0
      ? recentTrades.slice(0, 20).map((t) => {
          const tokenSym = tokenSymbolMap.get(t.tokenId) || "?";
          return `  ${t.action} ${tokenSym} @ ${t.price.toFixed(4)}`;
        }).join("\n")
      : "  None yet";

    // Build per-agent context
    const agentSections = agents.map((ctx) => {
      const { agent, holdings } = ctx;
      const celebrityNote = getCelebrityPrompt(agent.name)
        ? ` [Celebrity: trades in-character]`
        : "";
      const holdingsStr = holdings.length > 0
        ? holdings.map((h) => `${h.symbol}:${h.amount.toFixed(2)}`).join(", ")
        : "none";
      return `"${agent.name}" (${agent.riskLevel}${celebrityNote}): Cash=$${agent.cashBalance.toFixed(2)}, Holdings=[${holdingsStr}]`;
    }).join("\n");

    const prompt = `You are the trading decision engine for a virtual trading arena. Make trade decisions for ALL agents below in a single response.

POOLS (token/vUSD):
${poolsText}

AVAILABLE TOKENS: ${availableTokens}

RECENT MARKET ACTIVITY:
${tradesText}

AGENTS TO EVALUATE:
${agentSections}

RISK PROFILES:
- conservative: small positions (5-15%), only strong signals
- balanced: moderate positions (10-25%), balanced approach
- aggressive: larger positions (15-40%), frequent trading
- degen: massive positions (up to 50%), YOLO on any signal

RULES:
- Cash decay of 0.1% per cycle penalizes holding vUSD
- Each agent should make 0-2 trades max
- Respect each agent's risk profile for position sizing
- Not every agent needs to trade every cycle

Respond ONLY with this JSON format (no markdown, no explanation):
{
  "decisions": {
    "Agent Name": {
      "actions": [{"action":"BUY"|"SELL"|"HOLD","tokenSymbol":"<symbol>","amountVusd":<number>,"confidence":<0-1>,"reasoning":"<brief>"}]
    }
  }
}`;

    const response = await cerebras.chat.completions.create({
      model: process.env.TRADE_MODEL || "llama3.1-8b",
      temperature: 0.7,
      max_tokens: 4000,
      messages: [
        { role: "system", content: "You are a trading decision engine. Respond ONLY with valid JSON. No markdown code blocks." },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response from Cerebras");

    // Parse JSON - handle potential markdown code blocks
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    const decisions = parsed.decisions || parsed;

    for (const agentCtx of agents) {
      const name = agentCtx.agent.name;
      const agentDecision = decisions[name];
      if (agentDecision) {
        try {
          // Handle both formats: { actions: [...] } or just [...]
          const normalized = Array.isArray(agentDecision)
            ? { actions: agentDecision }
            : agentDecision;
          const validated = AIDecisionSchema.parse(normalized);
          results.set(name, validated);
        } catch {
          // Invalid format for this agent, skip
          results.set(name, { actions: [] });
        }
      } else {
        results.set(name, { actions: [] });
      }
    }

    return results;
  } catch (error) {
    console.error("Batch agent evaluation failed:", error);
    // Return empty decisions for all agents
    for (const ctx of agents) {
      results.set(ctx.agent.name, { actions: [] });
    }
    return results;
  }
}

// ============================================================================
// Single agent evaluation (legacy, kept as fallback)
// ============================================================================

/**
 * @deprecated Use evaluateAllAgents() for batch evaluation
 * Evaluate an agent and return AI-generated trade decisions.
 *
 * @param supabase - Supabase client
 * @param agent - The agent to evaluate
 * @param pools - All pools in the arena
 * @param poolPrices - Map of pool ID -> current price
 * @param allRecentTrades - Recent trades by all agents in the arena
 */
export async function evaluateAgent(
  supabase: SupabaseClient,
  agent: Agent,
  pools: Pool[],
  poolPrices: Map<string, number>,
  allRecentTrades: ArenaTrade[]
): Promise<AIDecision> {
  try {
    // Fetch agent's token holdings
    const { data: balances } = await supabase
      .from("arena_balances")
      .select("*, platform_tokens(symbol)")
      .eq("arena_id", agent.arenaId)
      .eq("agent_id", agent.id);

    // Fetch token symbols for pools
    const tokenIds = new Set<string>();
    for (const pool of pools) {
      tokenIds.add(pool.tokenId);
      tokenIds.add(pool.baseTokenId);
    }

    const { data: tokens } = await supabase
      .from("platform_tokens")
      .select("id, symbol")
      .in("id", Array.from(tokenIds));

    const tokenSymbolMap = new Map<string, string>();
    if (tokens) {
      for (const t of tokens) {
        tokenSymbolMap.set(t.id, t.symbol);
      }
    }

    const prompt = buildPrompt(
      agent,
      balances || [],
      pools,
      poolPrices,
      allRecentTrades,
      tokenSymbolMap
    );

    // Check if this is a celebrity agent — inject personality!
    const celebrityPrompt = getCelebrityPrompt(agent.name);
    const systemPrompt = celebrityPrompt
      ? `${celebrityPrompt}\n\nYou are competing in the Silicon Coliseum trading arena. You make trading decisions by swapping Silicon tokens (sBTC, sETH, sGOLD, sSILVER, sOIL, sWHEAT) via AMM pools. These track real-world prices! Respond ONLY with valid JSON. Stay in character in your reasoning!`
      : `You are an AI trading agent named "${agent.name}" competing in a virtual trading arena. You make trading decisions by swapping tokens via AMM pools. Respond ONLY with valid JSON.`;

    const response = await cerebras.chat.completions.create({
      model: "llama3.1-8b",
      temperature: 0.7,
      max_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Empty response from AI");
    }

    // Parse JSON response -- handle potential markdown code blocks
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    const validated = AIDecisionSchema.parse(parsed);

    return validated;
  } catch (error) {
    console.error(`Agent evaluation failed for ${agent.name}:`, error);
    return { actions: [] };
  }
}

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPrompt(
  agent: Agent,
  balances: Array<{ token_id: string; amount: number; platform_tokens?: { symbol: string } | null }>,
  pools: Pool[],
  poolPrices: Map<string, number>,
  recentTrades: ArenaTrade[],
  tokenSymbolMap: Map<string, string>
): string {
  // Format holdings
  const holdingsText = balances
    .filter((b) => b.amount > 0)
    .map((b) => {
      const symbol =
        b.platform_tokens?.symbol ||
        tokenSymbolMap.get(b.token_id) ||
        b.token_id;
      return `  - ${symbol}: ${b.amount.toFixed(4)}`;
    })
    .join("\n");

  // Format pool prices
  const poolsText = pools
    .map((p) => {
      const tokenSymbol = tokenSymbolMap.get(p.tokenId) || "?";
      const baseSymbol = tokenSymbolMap.get(p.baseTokenId) || "vUSD";
      const price = poolPrices.get(p.id) || calculatePrice(p.reserveToken, p.reserveBase);
      return `  - ${tokenSymbol}/${baseSymbol}: Price ${price.toFixed(6)} | Reserves: ${p.reserveToken.toFixed(2)} / ${p.reserveBase.toFixed(2)} | Fee: ${(p.feeRate * 100).toFixed(1)}%`;
    })
    .join("\n");

  // Format recent trades
  const tradesText =
    recentTrades.length > 0
      ? recentTrades
          .slice(0, 15)
          .map((t) => {
            const tokenSym = tokenSymbolMap.get(t.tokenId) || "?";
            return `  - ${t.action} ${t.amountIn.toFixed(2)} ${t.action === "BUY" ? "vUSD" : tokenSym} -> ${t.amountOut.toFixed(4)} ${t.action === "BUY" ? tokenSym : "vUSD"} (price: ${t.price.toFixed(6)})`;
          })
          .join("\n")
      : "  None";

  // Available token symbols
  const availableTokens = pools.map((p) => tokenSymbolMap.get(p.tokenId) || "?").join(", ");

  return `You are "${agent.name}", competing in a virtual trading arena.

RISK PROFILE: ${agent.riskLevel.toUpperCase()}
${RISK_PROFILES[agent.riskLevel]}
${agent.strategyDescription ? `\nCUSTOM STRATEGY: ${agent.strategyDescription}` : ""}

YOUR CASH BALANCE: ${agent.cashBalance.toFixed(2)} vUSD

YOUR TOKEN HOLDINGS:
${holdingsText || "  None"}

AVAILABLE POOLS (TOKEN/vUSD):
${poolsText}

AVAILABLE TOKENS: ${availableTokens}

RECENT TRADES BY ALL AGENTS (last 15):
${tradesText}

Based on the above, decide what trades to make. Consider:
1. Your risk profile and position sizing rules
2. Current balance allocation
3. Price trends from recent trades
4. Diversification across tokens
5. Cash decay penalty -- holding vUSD cash loses 0.1% per cycle

Respond ONLY with a JSON object:
{
  "actions": [
    {
      "action": "BUY" | "SELL" | "HOLD",
      "tokenSymbol": "<token symbol>",
      "amountVusd": <amount in vUSD (for BUY: how much vUSD to spend; for SELL: estimated vUSD value of tokens to sell)>,
      "confidence": <0.0 to 1.0>,
      "reasoning": "<why this trade>"
    }
  ]
}

If you decide not to trade, return { "actions": [{ "action": "HOLD", "tokenSymbol": "", "amountVusd": 0, "confidence": 1.0, "reasoning": "reason" }] }
Only use token symbols from the available tokens above.`;
}

// ============================================================================
// Legacy exports (backward compatibility)
// ============================================================================
import type {
  ArenaBalance,
  PoolAnalysis,
  ArenaAIDecisionResponse,
} from "./types";

// Re-export the legacy Agent type shape used by existing tests
type LegacyAgent = {
  id: string;
  user_id: string;
  name: string;
  risk_level: string;
  initial_budget: number;
  current_balance: number;
  tokens: string[];
  is_active: boolean;
  personality: string | null;
  strategy_description: string | null;
  is_npc: boolean;
  created_at: string;
};

/** @deprecated Use evaluateAgent instead */
export async function evaluateArenaAgent(
  agent: LegacyAgent,
  balances: Array<Record<string, unknown>>,
  pools: Array<Record<string, unknown>>,
  poolAnalyses: PoolAnalysis[],
  recentTrades: Array<Record<string, unknown>>,
  tokenSymbolMap: Map<string, string>
): Promise<ArenaAIDecisionResponse> {
  try {
    // Build a simplified prompt from legacy data
    const holdingsText = balances
      .filter((b) => (b.amount as number) > 0)
      .map((b) => {
        const symbol = tokenSymbolMap.get((b.token_id as string) || (b.tokenId as string) || "") || "?";
        return `  - ${symbol}: ${Number(b.amount).toFixed(4)}`;
      })
      .join("\n");

    const poolsText = pools
      .map((p) => {
        const reserveA = p.reserve_a as number || p.reserveToken as number || 0;
        const reserveB = p.reserve_b as number || p.reserveBase as number || 0;
        const price = reserveA > 0 && reserveB > 0 ? calculatePrice(reserveA, reserveB) : 0;
        const symbolA = (p.token_a_symbol as string) || tokenSymbolMap.get(p.token_a as string || "") || "?";
        const symbolB = (p.token_b_symbol as string) || tokenSymbolMap.get(p.token_b as string || "") || "?";
        return `  - ${symbolA}/${symbolB}: Price ${price.toFixed(6)}`;
      })
      .join("\n");

    const systemPrompt = agent.personality
      ? `You are an AI trading agent. ${agent.personality}`
      : "You are an AI trading agent. Respond only with valid JSON.";

    const prompt = `You are "${agent.name}" with risk profile ${agent.risk_level}.
${agent.strategy_description ? `Strategy: ${agent.strategy_description}` : ""}

Holdings:
${holdingsText || "  None"}

Pools:
${poolsText}

Respond with JSON: { "should_trade": boolean, "reasoning": string, "market_analysis": string, "actions": [{ "pool_id": string, "token_in": string, "token_out": string, "amount_in": number, "reason": string }] }`;

    const response = await cerebras.chat.completions.create({
      model: "llama3.1-8b",
      temperature: 0.7,
      max_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response");

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    return {
      should_trade: parsed.should_trade ?? false,
      reasoning: parsed.reasoning ?? "",
      market_analysis: parsed.market_analysis ?? "",
      actions: parsed.actions ?? [],
    };
  } catch (error) {
    console.error(`Legacy agent evaluation failed for ${agent.name}:`, error);
    return {
      should_trade: false,
      reasoning: "Failed to parse AI response",
      market_analysis: "",
      actions: [],
    };
  }
}
