import { NextResponse, NextRequest } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { createServiceClient } from "@/lib/supabase-server";
import { finalizeArena, calculateLeaderboard } from "@/lib/arena-manager";
import { resolveSolBets } from "@/lib/betting";
import {
  createSetRewardInstruction,
  createFinalizeArenaInstruction,
} from "@/lib/solana/program";
import { SOLANA_RPC_URL } from "@/lib/solana/constants";

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  try {
    // Verify CRON_SECRET
    const cronSecret =
      request.headers.get("x-cron-secret") ||
      request.headers.get("authorization")?.replace("Bearer ", "");

    if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Find arenas that are active and past their competition_end
    const { data: arenas, error } = await supabase
      .from("arenas")
      .select("*")
      .eq("status", "active")
      .lt("competition_end", new Date().toISOString());

    if (error) {
      console.error("Failed to fetch arenas for finalization:", error);
      return NextResponse.json(
        { error: "Failed to fetch arenas" },
        { status: 500 }
      );
    }

    if (!arenas || arenas.length === 0) {
      return NextResponse.json({
        message: "No arenas to finalize",
        finalized: [],
      });
    }

    const finalized: string[] = [];
    const errors: string[] = [];
    const solResults: Record<string, { performers: number; bettors: number; fee: number }> = {};
    const onChainResults: Record<string, { rewardsSet: number; finalized: boolean }> = {};

    for (const arena of arenas) {
      try {
        // Standard finalization (CP bets, rankings, CP rewards)
        await finalizeArena(supabase, arena.id);
        finalized.push(arena.id);

        // SOL bet resolution (creates sol_rewards for on-chain distribution)
        try {
          const leaderboard = await calculateLeaderboard(supabase, arena.id);
          const topAgentIds = leaderboard.map((e) => e.agentId);
          const solResult = await resolveSolBets(supabase, arena.id, topAgentIds);
          if (solResult.performerRewards.length > 0 || solResult.bettorRewards.length > 0) {
            solResults[arena.id] = {
              performers: solResult.performerRewards.length,
              bettors: solResult.bettorRewards.length,
              fee: solResult.feeAmount,
            };

            // Set rewards on-chain so users can claim
            const onChainResult = await setRewardsOnChain(
              arena.id,
              [...solResult.performerRewards, ...solResult.bettorRewards],
              solResult.feeAmount
            );
            onChainResults[arena.id] = onChainResult;

            // Record set_reward tx signatures in sol_rewards table
            for (const entry of onChainResult.txEntries) {
              if (entry.txSignature && entry.rewardId) {
                await supabase
                  .from("sol_rewards")
                  .update({ set_reward_tx: entry.txSignature })
                  .eq("id", entry.rewardId);
              }
            }
          }
        } catch (solErr) {
          console.error(`SOL bet resolution failed for arena ${arena.id}:`, solErr);
          errors.push(`SOL resolution ${arena.id}: ${solErr instanceof Error ? solErr.message : "unknown"}`);
        }
      } catch (err) {
        console.error(`Failed to finalize arena ${arena.id}:`, err);
        errors.push(
          `${arena.id}: ${err instanceof Error ? err.message : "unknown error"}`
        );
      }
    }

    return NextResponse.json({
      message: `Finalized ${finalized.length} arena(s)`,
      finalized,
      solRewards: Object.keys(solResults).length > 0 ? solResults : undefined,
      onChain: Object.keys(onChainResults).length > 0 ? onChainResults : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Cron finalize failed:", error);
    return NextResponse.json(
      { error: "Finalization failed" },
      { status: 500 }
    );
  }
}

/**
 * Call set_reward on-chain for each winner, then finalize_arena.
 * This registers rewards in the escrow PDA so users can claim.
 */
async function setRewardsOnChain(
  arenaId: string,
  rewards: Array<{ userId: string; walletAddress: string; amount: number; rewardId?: string }>,
  feeAmount: number
): Promise<{ rewardsSet: number; finalized: boolean; txEntries: Array<{ rewardId?: string; txSignature?: string }> }> {
  const adminPrivateKey = process.env.SOLANA_ADMIN_PRIVATE_KEY;
  if (!adminPrivateKey) {
    console.error("SOLANA_ADMIN_PRIVATE_KEY not set, skipping on-chain rewards");
    return { rewardsSet: 0, finalized: false, txEntries: [] };
  }

  const adminKeypair = Keypair.fromSecretKey(bs58.decode(adminPrivateKey));
  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const txEntries: Array<{ rewardId?: string; txSignature?: string }> = [];
  let rewardsSet = 0;

  // Set each reward on-chain
  for (const reward of rewards) {
    if (!reward.walletAddress || reward.amount <= 0) continue;

    try {
      const winnerPubkey = new PublicKey(reward.walletAddress);
      const instruction = await createSetRewardInstruction(
        adminKeypair.publicKey,
        arenaId,
        winnerPubkey,
        BigInt(reward.amount)
      );

      const tx = new Transaction().add(instruction);
      const sig = await sendAndConfirmTransaction(connection, tx, [adminKeypair]);

      txEntries.push({ rewardId: reward.rewardId, txSignature: sig });
      rewardsSet++;
    } catch (err) {
      console.error(`set_reward failed for ${reward.walletAddress}:`, err);
      txEntries.push({ rewardId: reward.rewardId });
    }
  }

  // Finalize arena on-chain (sends fee to treasury)
  let finalized = false;
  try {
    const instruction = await createFinalizeArenaInstruction(
      adminKeypair.publicKey,
      arenaId,
      BigInt(feeAmount)
    );

    const tx = new Transaction().add(instruction);
    await sendAndConfirmTransaction(connection, tx, [adminKeypair]);
    finalized = true;
  } catch (err) {
    console.error(`finalize_arena on-chain failed for ${arenaId}:`, err);
  }

  return { rewardsSet, finalized, txEntries };
}
