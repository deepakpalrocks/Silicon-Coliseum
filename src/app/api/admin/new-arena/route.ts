import { NextResponse, NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { getAllPrices, calculateReservesForPrice } from "@/lib/price-feed";
import { isAdminKeyConfigured, sendAdminTransaction } from "@/lib/solana/admin";
import { createArenaEscrowInstruction } from "@/lib/solana/program";
import { getAdminKeypair } from "@/lib/solana/admin";
import { getArenaEscrowPDA } from "@/lib/solana/utils";
import { getServerConnection } from "@/lib/solana/admin";

/**
 * POST /api/admin/new-arena
 * Creates a new active arena with real prices and enters all celebrity agents.
 * Protected by CRON_SECRET or admin auth.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authorization
    const cronSecret =
      request.headers.get("x-cron-secret") ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    const isCronAuth =
      process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

    if (!isCronAuth) {
      const { getSession } = await import("@/lib/auth");
      const session = await getSession(request);
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const supabase = createServiceClient();
      const { data: adminUser } = await supabase
        .from("users")
        .select("is_admin")
        .eq("id", session.userId)
        .maybeSingle();
      if (!adminUser?.is_admin) {
        return NextResponse.json(
          { error: "Admin access required" },
          { status: 403 }
        );
      }
    }

    const supabase = createServiceClient();
    const log: string[] = [];

    // Parse optional body
    let arenaName = "The Silicon Showdown";
    let bettingPhaseHours = 12; // minimum 12 hours betting phase
    let tradingPhaseHours = 2; // max 2 hours trading phase
    let betType: "cp_only" | "sol_only" | "both" = "both";
    try {
      const body = await request.json();
      if (body.name) arenaName = body.name;
      if (body.bettingPhaseHours !== undefined) bettingPhaseHours = Math.max(0, body.bettingPhaseHours);
      if (body.tradingPhaseHours !== undefined) tradingPhaseHours = Math.max(0.1, body.tradingPhaseHours);
      if (body.betType) betType = body.betType;
    } catch {
      // no body, use defaults
    }

    // Rule: Max 2 arenas can be in trading phase in a day
    const { data: tradingArenas } = await supabase
      .from("arenas")
      .select("id, betting_phase_end")
      .eq("status", "active");

    const now = new Date();
    const arenasCurrentlyTrading = (tradingArenas || []).filter((a) => {
      if (!a.betting_phase_end) return false;
      return new Date(a.betting_phase_end) <= now;
    });

    if (arenasCurrentlyTrading.length >= 2) {
      return NextResponse.json(
        { error: "Max 2 arenas can be in trading phase at a time. Wait for one to finish." },
        { status: 400 }
      );
    }

    // Get vUSD base currency
    const { data: baseToken } = await supabase
      .from("platform_tokens")
      .select("id")
      .eq("is_base_currency", true)
      .maybeSingle();

    if (!baseToken) {
      return NextResponse.json(
        { error: "vUSD base currency not found. Run /api/admin/seed first." },
        { status: 400 }
      );
    }
    const baseTokenId = baseToken.id;

    // Get all Silicon tokens (excluding deprecated ones)
    const EXCLUDED_TOKENS = ["BLOT", "MAGIC"];
    const { data: tokens } = await supabase
      .from("platform_tokens")
      .select("id, symbol")
      .eq("is_base_currency", false)
      .not("symbol", "in", `(${EXCLUDED_TOKENS.join(",")})`);

    if (!tokens || tokens.length === 0) {
      return NextResponse.json(
        { error: "No Silicon tokens found. Run /api/admin/seed first." },
        { status: 400 }
      );
    }

    // Get system user
    const { data: systemUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", "system@silicon-coliseum.ai")
      .maybeSingle();

    if (!systemUser) {
      return NextResponse.json(
        { error: "System user not found. Run /api/admin/seed first." },
        { status: 400 }
      );
    }

    // Create new arena: betting phase (12h+) then trading phase (max 2h)
    const startTime = new Date();
    const bettingPhaseEnd = new Date(startTime.getTime() + bettingPhaseHours * 60 * 60 * 1000);
    const endTime = new Date(bettingPhaseEnd.getTime() + tradingPhaseHours * 60 * 60 * 1000);

    const { data: newArena, error: arenaError } = await supabase
      .from("arenas")
      .insert({
        name: arenaName,
        description: `Celebrity AI agents battle it out trading real-world assets! ${bettingPhaseHours}h betting + ${tradingPhaseHours}h trading.`,
        status: "active",
        starting_balance: 100000,
        max_agents: 20,
        decay_rate: 0.001,
        competition_start: startTime.toISOString(),
        competition_end: endTime.toISOString(),
        betting_phase_end: bettingPhaseEnd.toISOString(),
        bet_type: betType,
        created_by: systemUser.id,
      })
      .select()
      .single();

    if (arenaError || !newArena) {
      console.error("Failed to create arena:", arenaError);
      return NextResponse.json(
        { error: `Failed to create arena: ${arenaError?.message}` },
        { status: 500 }
      );
    }

    log.push(`Created arena: "${arenaName}" (${bettingPhaseHours}h betting + ${tradingPhaseHours}h trading)`);

    // Create on-chain arena escrow for SOL bets
    if (
      (betType === "sol_only" || betType === "both") &&
      isAdminKeyConfigured()
    ) {
      try {
        const admin = getAdminKeypair();
        const [escrowPDA] = getArenaEscrowPDA(newArena.id);

        // Check if escrow already exists (idempotent)
        const conn = getServerConnection();
        const existing = await conn.getAccountInfo(escrowPDA);
        if (existing) {
          log.push(`Arena escrow already exists on-chain: ${escrowPDA.toBase58()}`);
        } else {
          const ix = await createArenaEscrowInstruction(
            admin.publicKey,
            newArena.id
          );
          const sig = await sendAdminTransaction(ix);
          log.push(
            `Created on-chain arena escrow: ${escrowPDA.toBase58()} (tx: ${sig})`
          );
        }
      } catch (escrowErr) {
        const msg =
          escrowErr instanceof Error ? escrowErr.message : "unknown error";
        log.push(`WARNING: Failed to create on-chain escrow: ${msg}`);
        console.error("Failed to create arena escrow on-chain:", escrowErr);
        // Non-fatal: arena still works for CP bets, SOL bets will fail
      }
    } else if (betType === "sol_only" || betType === "both") {
      log.push(
        "WARNING: SOLANA_ADMIN_PRIVATE_KEY not configured — skipped on-chain escrow creation. SOL bets will not work."
      );
    }

    // Create pools with real prices
    const prices = await getAllPrices();

    for (const token of tokens) {
      const priceData = prices.get(token.symbol);
      const targetPrice = priceData?.priceUsd || 100;

      const { reserveToken, reserveBase } = calculateReservesForPrice(targetPrice, 500000);

      await supabase.from("pools").insert({
        arena_id: newArena.id,
        token_id: token.id,
        base_token_id: baseTokenId,
        reserve_token: reserveToken,
        reserve_base: reserveBase,
        fee_rate: 0.003,
        total_volume: 0,
      });

      await supabase.from("arena_tokens").insert({
        arena_id: newArena.id,
        token_id: token.id,
      });

      log.push(`Created pool: ${token.symbol}/vUSD @ $${targetPrice.toFixed(2)}`);
    }

    // Get all celebrity agents (owned by system user) and pick random 20
    const { data: agents } = await supabase
      .from("agents")
      .select("id, name")
      .eq("user_id", systemUser.id);

    if (agents && agents.length > 0) {
      // Shuffle and pick up to 20
      const shuffled = [...agents].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 20);

      for (const agent of selected) {
        const { error: entryError } = await supabase.from("arena_entries").insert({
          arena_id: newArena.id,
          agent_id: agent.id,
          cash_balance: 100000,
          status: "active",
        });
        if (entryError) {
          log.push(`FAILED to enter "${agent.name}": ${entryError.message}`);
        } else {
          log.push(`Entered "${agent.name}" into arena`);
        }
      }
      log.push(`Selected ${selected.length} of ${agents.length} agents for this arena`);
    } else {
      log.push("WARNING: No celebrity agents found in agents table");
    }

    // Auto-generate initial trash talk comments
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://silicon-coliseum.vercel.app";
      const commentRes = await fetch(`${siteUrl}/api/cron/generate-comments`, {
        method: "POST",
        headers: {
          "x-cron-secret": process.env.CRON_SECRET || "",
        },
      });
      if (commentRes.ok) {
        const commentData = await commentRes.json();
        log.push(`Auto-generated ${commentData.generated || 0} trash talk comments`);
      }
    } catch {
      log.push("WARNING: Failed to auto-generate trash talk (non-fatal)");
    }

    return NextResponse.json({
      success: true,
      message: `New arena "${arenaName}" created!`,
      arenaId: newArena.id,
      log,
    });
  } catch (error) {
    console.error("New arena failed:", error);
    return NextResponse.json(
      { error: `Failed: ${error instanceof Error ? error.message : "unknown"}` },
      { status: 500 }
    );
  }
}
