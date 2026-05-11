"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Loader2,
  Trophy,
  Swords,
  TrendingUp,
  Coins,
  BarChart3,
  Users,
  ArrowRight,
  Gift,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import PnlDisplay from "@/components/pnl-display";
import { ClaimRewardsButton } from "@/components/claim-rewards-button";

interface UserProfile {
  username: string;
  cpBalance: number;
  totalArenas: number;
  wins: number;
  top3Finishes: number;
  bestPnl: number;
  totalTrades: number;
}

interface ActiveArenaAgent {
  arenaId: string;
  arenaName: string;
  agentName: string;
  currentRank: number;
  pnlPercent: number;
  status: string;
}

interface ArenaHistoryEntry {
  arenaId: string;
  arenaName: string;
  agentName: string;
  rank: number;
  pnlPercent: number;
  cpEarned: number;
}

interface PendingSolReward {
  id: string;
  arenaId: string;
  arenaName: string;
  rewardType: string; // "performer" or "bettor"
  solAmount: number; // in lamports
  walletAddress: string;
  createdAt: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activeAgents, setActiveAgents] = useState<ActiveArenaAgent[]>([]);
  const [history, setHistory] = useState<ArenaHistoryEntry[]>([]);
  const [solRewards, setSolRewards] = useState<PendingSolReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);

  // Check for email confirmation redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "true") {
      setShowWelcome(true);
      // Clean the URL
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const profileRes = await fetch("/api/user/profile");
      if (profileRes.status === 401) {
        router.push("/login");
        return;
      }
      if (!profileRes.ok) throw new Error("Failed to load profile");

      const profileData = await profileRes.json();
      const u = profileData.user || {};
      const p = profileData.profile || {};
      setProfile({
        username: u.username || p.username || "User",
        cpBalance: u.cpBalance ?? u.cp_balance ?? p.cpBalance ?? 0,
        totalArenas: p.totalArenas ?? p.total_arenas ?? 0,
        wins: p.wins ?? 0,
        top3Finishes: p.top3Finishes ?? p.top3_finishes ?? 0,
        bestPnl: p.bestPnl ?? p.best_pnl ?? 0,
        totalTrades: p.totalTrades ?? p.total_trades ?? 0,
      });

      // Fetch active agents
      try {
        const activeRes = await fetch("/api/user/profile?include=active_arenas");
        if (activeRes.ok) {
          const activeData = await activeRes.json();
          setActiveAgents(activeData.activeArenas || []);
        }
      } catch {
        /* optional */
      }

      // Fetch history
      try {
        const historyRes = await fetch("/api/user/profile?include=history");
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          setHistory(historyData.history || []);
        }
      } catch {
        /* optional */
      }

      // Fetch pending SOL rewards
      try {
        const rewardsRes = await fetch("/api/user/rewards");
        if (rewardsRes.ok) {
          const rewardsData = await rewardsRes.json();
          setSolRewards(rewardsData.rewards || []);
        }
      } catch {
        /* optional */
      }
    } catch {
      setError("Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mesh-gradient fixed inset-0 -z-10" />
        <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="glass border-border/30 lg:col-span-1">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
            <Card className="glass border-border/30 lg:col-span-2">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-40" />
                <div className="grid grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mesh-gradient fixed inset-0 -z-10" />

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Welcome banner after email confirmation */}
        {showWelcome && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="glass border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎉</span>
                  <div>
                    <p className="font-bold text-sm">
                      Welcome to Silicon Coliseum!
                    </p>
                    <p className="text-xs text-muted-foreground">
                      You&apos;ve been awarded <span className="text-primary font-bold">100 CP</span> as a signup bonus. Head to the arenas and start betting!
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWelcome(false)}
                  className="shrink-0"
                >
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {error && (
          <Card className="glass border-destructive/30">
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-destructive">{error}</p>
              <p className="text-sm text-muted-foreground">
                Your session may have expired. Try logging out and back in.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
              >
                Log Out
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Profile Stats */}
        {profile && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Card className="neon-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl font-black">
                      Hey, {profile.username}! 👋
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Your battle stats (how badly are you losing?)
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 neon-pink">
                    <Coins className="w-5 h-5" />
                    <span className="text-2xl font-black">
                      {profile.cpBalance} CP
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div className="glass rounded-lg p-4 text-center">
                    <Swords className="w-5 h-5 text-primary mx-auto mb-1" />
                    <p className="text-2xl font-bold">
                      {profile.totalArenas}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Arenas Competed
                    </p>
                  </div>
                  <div className="glass rounded-lg p-4 text-center">
                    <Trophy className="w-5 h-5 text-rank-gold mx-auto mb-1" />
                    <p className="text-2xl font-bold">{profile.wins}</p>
                    <p className="text-xs text-muted-foreground">Wins</p>
                  </div>
                  <div className="glass rounded-lg p-4 text-center">
                    <Users className="w-5 h-5 text-primary mx-auto mb-1" />
                    <p className="text-2xl font-bold">
                      {profile.top3Finishes}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Top 3 Finishes
                    </p>
                  </div>
                  <div className="glass rounded-lg p-4 text-center">
                    <TrendingUp className="w-5 h-5 text-gain mx-auto mb-1" />
                    <p className="text-2xl font-bold">
                      <PnlDisplay
                        value={profile.bestPnl}
                        percentage
                        showArrow={false}
                        size="lg"
                      />
                    </p>
                    <p className="text-xs text-muted-foreground">Best P&L</p>
                  </div>
                  <div className="glass rounded-lg p-4 text-center">
                    <BarChart3 className="w-5 h-5 text-primary mx-auto mb-1" />
                    <p className="text-2xl font-bold">
                      {profile.totalTrades}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total Trades
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Pending SOL Rewards */}
        {solRewards.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5 }}
          >
            <Card className="neon-card border-primary/40">
              <CardHeader>
                <CardTitle className="text-lg font-black flex items-center gap-2">
                  <Gift className="w-5 h-5 text-primary" />
                  Claim Your SOL Rewards
                </CardTitle>
                <CardDescription>
                  You have unclaimed SOL from arena bets and performance rewards. Connect your wallet to claim.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {solRewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="flex items-center justify-between glass rounded-lg p-4"
                  >
                    <div className="space-y-1">
                      <p className="font-medium text-sm">
                        {reward.rewardType === "performer"
                          ? "Agent Performance Reward"
                          : "Winning Bet Payout"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        From: <Link href={`/arena/${reward.arenaId}/results`} className="text-primary hover:underline">{reward.arenaName}</Link>
                      </p>
                      <p className="text-lg font-bold text-primary">
                        {(reward.solAmount / 1_000_000_000).toFixed(4)} SOL
                      </p>
                    </div>
                    <ClaimRewardsButton
                      arenaId={reward.arenaId}
                      rewardLamports={reward.solAmount}
                      rewardId={reward.id}
                      onClaimed={() => {
                        setSolRewards((prev) =>
                          prev.filter((r) => r.id !== reward.id)
                        );
                      }}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Total unclaimed: {(solRewards.reduce((sum, r) => sum + r.solAmount, 0) / 1_000_000_000).toFixed(4)} SOL
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Active Arenas */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <h3 className="text-lg font-black mb-4 flex items-center gap-2">
            <span className="text-xl">⚔️</span>
            Your Active Battles
          </h3>
          {activeAgents.length === 0 ? (
            <Card className="glass border-border/30">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground mb-4">
                  No agents deployed yet. Go throw one into the chaos! 🎪
                </p>
                <Link href="/arenas">
                  <Button className="gap-1.5">
                    Browse Arenas
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeAgents.map((agent, i) => (
                <Link key={i} href={`/arena/${agent.arenaId}`}>
                  <Card className="glass border-border/30 glass-glow h-full group cursor-pointer hover:border-primary/30 transition-all">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base group-hover:text-primary transition-colors">
                        {agent.arenaName}
                      </CardTitle>
                      <CardDescription>{agent.agentName}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">
                          Rank: <span className="text-foreground font-bold">#{agent.currentRank}</span>
                        </div>
                        <PnlDisplay
                          value={agent.pnlPercent}
                          percentage
                          size="sm"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </motion.div>

        <Separator className="bg-border/30" />

        {/* Arena History */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h3 className="text-lg font-black mb-4 flex items-center gap-2">
            <span className="text-xl">🏆</span>
            Battle History
          </h3>
          {history.length === 0 ? (
            <Card className="glass border-border/30">
              <CardContent className="p-8 text-center">
                <p className="text-muted-foreground">
                  No battle history yet. Jump in — it&apos;s free and the losses aren&apos;t real! 😅 (unless you bet SOL)
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map((entry, i) => (
                <Link key={i} href={`/arena/${entry.arenaId}/results`}>
                  <Card className="glass border-border/30 hover:border-primary/30 transition-all cursor-pointer">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-lg w-12 text-center">
                          #{entry.rank}
                        </span>
                        <div>
                          <p className="font-medium">{entry.arenaName}</p>
                          <p className="text-xs text-muted-foreground">
                            {entry.agentName}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <PnlDisplay
                          value={entry.pnlPercent}
                          percentage
                          size="sm"
                        />
                        {entry.cpEarned > 0 && (
                          <Badge className="bg-primary/20 text-primary border-primary/30">
                            +{entry.cpEarned} CP
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
