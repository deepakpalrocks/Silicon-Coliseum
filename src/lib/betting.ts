import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Betting System -- spectators bet CP or SOL on which agents will finish top 3.
 *
 * CP bets: Losing pool splits 50/50 between agent owners and winning bettors.
 *
 * SOL bets: 50% of losers' SOL goes to top arena performers:
 *   1st: 50%, 2nd: 25%, 3rd: 20%, contract fee: 5%
 * Remaining 50% of losers' SOL goes to winning bettors (proportional to bet size).
 */

/**
 * Place a bet on an agent to finish in the top 3.
 * Validates: user is a spectator (no agent in this arena), has enough CP.
 * Deducts CP and creates bet record.
 */
export async function placeBet(
  supabase: SupabaseClient,
  arenaId: string,
  userId: string,
  agentId: string,
  cpAmount: number
): Promise<void> {
  if (cpAmount <= 0) {
    throw new Error("Bet amount must be positive");
  }

  // Check user is not a participant (spectator only)
  const { data: existingAgent } = await supabase
    .from("agents")
    .select("id")
    .eq("arena_id", arenaId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingAgent) {
    throw new Error("Participants cannot bet on their own arena");
  }

  // Check user has enough CP
  const { data: user } = await supabase
    .from("users")
    .select("cp_balance")
    .eq("id", userId)
    .single();

  if (!user || user.cp_balance < cpAmount) {
    throw new Error("Insufficient Coliseum Points");
  }

  // Deduct CP
  const { error: deductError } = await supabase
    .from("users")
    .update({ cp_balance: user.cp_balance - cpAmount })
    .eq("id", userId);

  if (deductError) {
    throw new Error(`Failed to deduct CP: ${deductError.message}`);
  }

  // Create bet record
  const { error: betError } = await supabase.from("bets").insert({
    arena_id: arenaId,
    user_id: userId,
    agent_id: agentId,
    cp_amount: cpAmount,
    status: "pending",
    payout: 0,
  });

  if (betError) {
    // Refund CP on failure
    await supabase
      .from("users")
      .update({ cp_balance: user.cp_balance })
      .eq("id", userId);
    throw new Error(`Failed to place bet: ${betError.message}`);
  }

  // Record CP transaction
  await supabase.from("cp_transactions").insert({
    user_id: userId,
    amount: -cpAmount,
    type: "spend",
    source: "bet_placed",
    arena_id: arenaId,
  });
}

/**
 * Resolve all bets for a completed arena.
 * Top 3 agent IDs are winners. Bets on top-3 agents win.
 *
 * Losing pool (total CP from losing bets) splits:
 *   50% -> agent owners (top 10, weighted by rank)
 *   50% -> winning bettors (proportional to bet size)
 *
 * Winning bettors get their original bet back + share of 50% losing pool.
 */
export async function resolveBets(
  supabase: SupabaseClient,
  arenaId: string,
  topAgentIds: string[]
): Promise<void> {
  const top3Ids = new Set(topAgentIds.slice(0, 3));

  // Fetch all pending CP bets for this arena (skip SOL bets — handled by resolveSolBets)
  const { data: bets, error: betsError } = await supabase
    .from("bets")
    .select("*")
    .eq("arena_id", arenaId)
    .eq("status", "pending")
    .or("bet_currency.eq.cp,bet_currency.is.null");

  if (betsError || !bets || bets.length === 0) return;

  // Separate winning and losing bets
  const winningBets = bets.filter((b) => top3Ids.has(b.agent_id));
  const losingBets = bets.filter((b) => !top3Ids.has(b.agent_id));

  const losingPool = losingBets.reduce((sum, b) => sum + b.cp_amount, 0);
  const bettorShare = losingPool * 0.5;
  const ownerShare = losingPool * 0.5;

  // --- Pay winning bettors ---
  const totalWinningBetAmount = winningBets.reduce((sum, b) => sum + b.cp_amount, 0);

  for (const bet of winningBets) {
    // Proportional share of bettor pool
    const proportion =
      totalWinningBetAmount > 0 ? bet.cp_amount / totalWinningBetAmount : 0;
    const winnings = bettorShare * proportion;
    const payout = bet.cp_amount + winnings; // Original bet + winnings

    // Update bet status
    await supabase
      .from("bets")
      .update({ status: "won", payout })
      .eq("id", bet.id);

    // Credit user CP
    const { data: user } = await supabase
      .from("users")
      .select("cp_balance")
      .eq("id", bet.user_id)
      .single();

    if (user) {
      await supabase
        .from("users")
        .update({ cp_balance: user.cp_balance + payout })
        .eq("id", bet.user_id);

      await supabase.from("cp_transactions").insert({
        user_id: bet.user_id,
        amount: payout,
        type: "payout",
        source: "bet_payout",
        arena_id: arenaId,
      });
    }
  }

  // --- Mark losing bets ---
  for (const bet of losingBets) {
    await supabase
      .from("bets")
      .update({ status: "lost", payout: 0 })
      .eq("id", bet.id);
  }

  // --- Distribute owner share to top 10 agent owners ---
  // Distribution: #1=25%, #2=15%, #3=12%, #4-10=~7% each (split evenly)
  if (ownerShare > 0 && topAgentIds.length > 0) {
    const ownerDistribution = [0.25, 0.15, 0.12];
    const remainingSlots = Math.min(topAgentIds.length, 10) - 3;
    if (remainingSlots > 0) {
      const perSlot = (1 - 0.25 - 0.15 - 0.12) / Math.max(remainingSlots, 1);
      for (let i = 0; i < remainingSlots; i++) {
        ownerDistribution.push(perSlot);
      }
    }

    for (let i = 0; i < Math.min(topAgentIds.length, 10); i++) {
      const agentId = topAgentIds[i];
      const share = ownerShare * (ownerDistribution[i] || 0);

      if (share <= 0) continue;

      // Find the agent's owner
      const { data: agent } = await supabase
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .single();

      if (agent) {
        const { data: owner } = await supabase
          .from("users")
          .select("cp_balance")
          .eq("id", agent.user_id)
          .single();

        if (owner) {
          await supabase
            .from("users")
            .update({ cp_balance: owner.cp_balance + share })
            .eq("id", agent.user_id);

          await supabase.from("cp_transactions").insert({
            user_id: agent.user_id,
            amount: share,
            type: "payout",
            source: "arena_owner_share",
            arena_id: arenaId,
          });
        }
      }
    }
  }
}

// ============================================================================
// SOL Bet Resolution
// ============================================================================

/**
 * Resolve SOL bets for a completed arena.
 * Distribution:
 *   50% of losers' SOL → top 3 performers (50%/25%/20%) + 5% fee
 *   50% of losers' SOL → winning bettors (proportional to bet size)
 *
 * Creates sol_rewards records for each winner to claim on-chain.
 */
export async function resolveSolBets(
  supabase: SupabaseClient,
  arenaId: string,
  topAgentIds: string[]
): Promise<{
  performerRewards: { userId: string; walletAddress: string; amount: number; rewardId?: string }[];
  bettorRewards: { userId: string; walletAddress: string; amount: number; rewardId?: string }[];
  feeAmount: number;
}> {
  const top3Ids = new Set(topAgentIds.slice(0, 3));

  // Fetch all pending SOL bets for this arena
  const { data: solBets, error: betsError } = await supabase
    .from("bets")
    .select("*")
    .eq("arena_id", arenaId)
    .eq("bet_currency", "sol")
    .eq("status", "pending");

  if (betsError || !solBets || solBets.length === 0) {
    return { performerRewards: [], bettorRewards: [], feeAmount: 0 };
  }

  const winningBets = solBets.filter((b) => top3Ids.has(b.agent_id));
  const losingBets = solBets.filter((b) => !top3Ids.has(b.agent_id));

  const losingPoolLamports = losingBets.reduce(
    (sum, b) => sum + (b.sol_amount || 0),
    0
  );

  const performerPool = Math.floor(losingPoolLamports * 0.5);
  const bettorPool = losingPoolLamports - performerPool;

  // --- Performer rewards (50% of losing pool) ---
  // 1st: 50%, 2nd: 25%, 3rd: 20%, 5% fee
  const performerDistribution = [0.5, 0.25, 0.2];
  const feeRate = 0.05;
  let feeAmount = Math.floor(performerPool * feeRate);
  const performerRewards: { userId: string; walletAddress: string; amount: number; rewardId?: string }[] = [];

  // Get treasury address for unclaimed performer shares
  const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_WALLET || "";

  for (let i = 0; i < Math.min(topAgentIds.length, 3); i++) {
    const agentId = topAgentIds[i];
    const share = Math.floor(performerPool * (performerDistribution[i] || 0));
    if (share <= 0) continue;

    const { data: agent } = await supabase
      .from("agents")
      .select("user_id, payout_wallet")
      .eq("id", agentId)
      .single();

    if (!agent) continue;

    // Try agent's payout_wallet first, then owner's wallet_address
    let walletAddress = agent.payout_wallet || null;
    if (!walletAddress) {
      const { data: owner } = await supabase
        .from("users")
        .select("wallet_address")
        .eq("id", agent.user_id)
        .single();
      walletAddress = owner?.wallet_address || null;
    }

    if (!walletAddress) {
      // No wallet configured — redirect this share to treasury
      feeAmount += share;
      continue;
    }

    const { data: insertedReward } = await supabase.from("sol_rewards").insert({
      arena_id: arenaId,
      user_id: agent.user_id,
      wallet_address: walletAddress,
      reward_type: "performer",
      sol_amount: share,
    }).select("id").single();

    performerRewards.push({
      userId: agent.user_id,
      walletAddress,
      amount: share,
      rewardId: insertedReward?.id,
    });
  }

  // --- Bettor rewards (50% of losing pool → winning bettors proportional) ---
  const totalWinningBetLamports = winningBets.reduce(
    (sum, b) => sum + (b.sol_amount || 0),
    0
  );
  const bettorRewards: { userId: string; walletAddress: string; amount: number; rewardId?: string }[] = [];

  for (const bet of winningBets) {
    const proportion =
      totalWinningBetLamports > 0
        ? (bet.sol_amount || 0) / totalWinningBetLamports
        : 0;
    const winnings = Math.floor(bettorPool * proportion);
    const payout = (bet.sol_amount || 0) + winnings; // original + winnings

    // Update bet status
    await supabase
      .from("bets")
      .update({ status: "won", payout: payout })
      .eq("id", bet.id);

    if (bet.wallet_address && payout > 0) {
      const { data: insertedReward } = await supabase.from("sol_rewards").insert({
        arena_id: arenaId,
        user_id: bet.user_id,
        wallet_address: bet.wallet_address,
        reward_type: "bettor",
        sol_amount: payout,
      }).select("id").single();

      bettorRewards.push({
        userId: bet.user_id,
        walletAddress: bet.wallet_address,
        amount: payout,
        rewardId: insertedReward?.id,
      });
    }
  }

  // Mark losing SOL bets
  for (const bet of losingBets) {
    await supabase
      .from("bets")
      .update({ status: "lost", payout: 0 })
      .eq("id", bet.id);
  }

  return { performerRewards, bettorRewards, feeAmount };
}
