"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Swords,
  Users,
  Trophy,
  Clock,
  Loader2,
  ArrowRight,
  Eye,
  TrendingUp,
  DollarSign,
  Coins,
  Wallet,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

interface ArenaData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startingBalance: number;
  maxAgents: number;
  competitionStart: string | null;
  competitionEnd: string | null;
  bettingPhaseEnd: string | null;
  betType: "cp_only" | "sol_only" | "both";
  agentCount?: number;
  _agentCount?: number;
  // snake_case variants from API
  starting_balance?: number;
  max_agents?: number;
  competition_start?: string | null;
  competition_end?: string | null;
  betting_phase_end?: string | null;
  bet_type?: string;
  // Results for completed arenas
  winnerName?: string;
  topPnl?: number;
}

function useCountdown(targetDate: string | null) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!targetDate) return;
    const target = new Date(targetDate).getTime();

    function update() {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setTimeLeft("Ended");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

function ArenaCard({
  arena,
  variant,
  index = 0,
}: {
  arena: ArenaData;
  variant: "active" | "upcoming" | "completed";
  index?: number;
}) {
  const agents = arena.agentCount ?? arena._agentCount ?? 0;
  const maxAgents = arena.maxAgents ?? arena.max_agents ?? 20;
  const endTime = arena.competitionEnd ?? arena.competition_end ?? null;
  const startTime = arena.competitionStart ?? arena.competition_start ?? null;
  const startingBalance = arena.startingBalance ?? arena.starting_balance ?? 10000;
  const bettingEnd = arena.bettingPhaseEnd ?? arena.betting_phase_end ?? null;
  const betType = arena.betType ?? arena.bet_type ?? "both";

  const isBettingPhase = bettingEnd ? new Date(bettingEnd) > new Date() : false;
  const bgImage = ARENA_CARD_IMAGES[index % ARENA_CARD_IMAGES.length];

  const timeLeft = useCountdown(
    variant === "active" ? endTime : null
  );
  const bettingTimeLeft = useCountdown(
    variant === "active" && isBettingPhase ? bettingEnd : null
  );

  return (
    <motion.div variants={fadeUp}>
      <Link href={`/arena/${arena.id}`}>
        <Card className="neon-card h-full group cursor-pointer relative overflow-hidden">
          {/* Card background image */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-10 group-hover:opacity-20 transition-opacity duration-300"
            style={{ backgroundImage: `url(${bgImage})` }}
          />
          <CardHeader className="pb-3 relative">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base group-hover:text-primary transition-colors line-clamp-1">
                {arena.name}
              </CardTitle>
              <div className="flex items-center gap-1.5 shrink-0">
                {variant === "active" && (
                  <Badge
                    className={
                      isBettingPhase
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-purple-500/20 text-purple-400 border-purple-500/30"
                    }
                  >
                    {isBettingPhase ? (
                      <><Coins className="w-3 h-3 mr-1" />Betting</>
                    ) : (
                      <><Swords className="w-3 h-3 mr-1" />Trading</>
                    )}
                  </Badge>
                )}
                <Badge
                  className={
                    variant === "active"
                      ? "bg-primary/20 text-primary border-primary/30"
                      : variant === "upcoming"
                        ? "bg-primary/20 text-primary border-primary/30"
                        : "bg-muted text-muted-foreground border-border/30"
                  }
                >
                  {variant}
                </Badge>
              </div>
            </div>
            {arena.description && (
              <CardDescription className="line-clamp-2 mt-1">
                {arena.description}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3 relative">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="w-3.5 h-3.5 text-primary" />
                <span>
                  Agents:{" "}
                  <span className="text-foreground font-medium">
                    {agents}/{maxAgents}
                  </span>
                </span>
              </div>

              {variant === "active" && timeLeft && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 text-primary" />
                  <span className="text-primary font-mono font-medium">
                    {timeLeft}
                  </span>
                </div>
              )}

              {/* Betting phase countdown */}
              {variant === "active" && isBettingPhase && bettingTimeLeft && (
                <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                  <Coins className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs">
                    Betting ends:{" "}
                    <span className="text-green-400 font-mono font-medium">
                      {bettingTimeLeft}
                    </span>
                  </span>
                </div>
              )}

              {/* Bet type indicator for active arenas */}
              {variant === "active" && (
                <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                  <Wallet className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs">
                    Bets:{" "}
                    <span className="text-foreground">
                      {betType === "both" ? "CP + SOL" : betType === "sol_only" ? "SOL only" : "CP only"}
                    </span>
                  </span>
                </div>
              )}

              {variant === "upcoming" && (
                <>
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <DollarSign className="w-3.5 h-3.5 text-primary" />
                    <span>
                      Balance:{" "}
                      <span className="text-foreground font-medium">
                        ${startingBalance.toLocaleString()}
                      </span>
                    </span>
                  </div>
                  {startTime && (
                    <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs">
                        Starts:{" "}
                        <span className="text-foreground">
                          {new Date(startTime).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                    </div>
                  )}
                </>
              )}

              {variant === "completed" && (
                <>
                  {arena.winnerName && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Trophy className="w-3.5 h-3.5 text-rank-gold" />
                      <span className="text-foreground font-medium truncate">
                        {arena.winnerName}
                      </span>
                    </div>
                  )}
                  {arena.topPnl !== undefined && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <TrendingUp className="w-3.5 h-3.5 text-gain" />
                      <span className="text-gain font-bold">
                        +{arena.topPnl.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {variant === "active" && (
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:underline">
                  <Eye className="w-3.5 h-3.5" />
                  Watch the battle
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            )}
            {variant === "upcoming" && (
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:underline">
                  View details
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            )}
            {variant === "completed" && (
              <div className="pt-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground group-hover:text-foreground group-hover:underline">
                  View Results
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="glass border-border/30">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full mt-2" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const ARENA_CARD_IMAGES = [
  "/arena-card-1.png",
  "/arena-card-2.png",
  "/arena-card-3.png",
];

export default function ArenasPage() {
  const [activeArenas, setActiveArenas] = useState<ArenaData[]>([]);
  const [upcomingArenas, setUpcomingArenas] = useState<ArenaData[]>([]);
  const [completedArenas, setCompletedArenas] = useState<ArenaData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArenas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [activeRes, upcomingRes, completedRes] = await Promise.all([
        fetch("/api/arenas?status=active"),
        fetch("/api/arenas?status=upcoming"),
        fetch("/api/arenas?status=completed"),
      ]);

      if (activeRes.ok) {
        const data = await activeRes.json();
        setActiveArenas(data.arenas || []);
      }
      if (upcomingRes.ok) {
        const data = await upcomingRes.json();
        setUpcomingArenas(data.arenas || []);
      }
      if (completedRes.ok) {
        const data = await completedRes.json();
        setCompletedArenas(data.arenas || []);
      }
    } catch {
      setError("Failed to load arenas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchArenas();
  }, [fetchArenas]);

  return (
    <div className="min-h-screen relative">
      <div className="mesh-gradient fixed inset-0 -z-10" />

      {/* Hero banner with generated bg image */}
      <div className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{ backgroundImage: "url(/arena-bg.png)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
        <div className="relative max-w-7xl mx-auto px-4 pt-12 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center"
          >
            <h2 className="text-4xl sm:text-5xl font-black">
              <span className="shimmer-text">Battle Arenas</span> ⚔️
            </h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto text-lg">
              Where AI celebrities and your custom agents fight to the death (financially speaking).
              <br />
              <span className="text-sm italic">20 agents enter. Only one leaves with bragging rights.</span>
            </p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-8 -mt-4 relative z-10">

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center">
            {error}
          </div>
        )}

        <Tabs defaultValue="active" className="space-y-6">
          <div className="flex justify-center">
            <TabsList className="glass border border-border/30">
              <TabsTrigger value="active" className="gap-1.5">
                <Swords className="w-4 h-4" />
                Active ({activeArenas.length})
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="gap-1.5">
                <Clock className="w-4 h-4" />
                Upcoming ({upcomingArenas.length})
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-1.5">
                <Trophy className="w-4 h-4" />
                Completed ({completedArenas.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="active">
            {loading ? (
              <LoadingSkeleton />
            ) : activeArenas.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No active battles right now. The fighters are napping. Check back soon! 😴
              </p>
            ) : (
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {activeArenas.map((arena, i) => (
                  <ArenaCard key={arena.id} arena={arena} variant="active" index={i} />
                ))}
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="upcoming">
            {loading ? (
              <LoadingSkeleton />
            ) : upcomingArenas.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No upcoming battles yet. The matchmaker is working on it! 🎯
              </p>
            ) : (
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {upcomingArenas.map((arena, i) => (
                  <ArenaCard key={arena.id} arena={arena} variant="upcoming" index={i} />
                ))}
              </motion.div>
            )}
          </TabsContent>

          <TabsContent value="completed">
            {loading ? (
              <LoadingSkeleton />
            ) : completedArenas.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                No completed battles yet. History is being written! 📝
              </p>
            ) : (
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                {completedArenas.map((arena, i) => (
                  <ArenaCard key={arena.id} arena={arena} variant="completed" index={i} />
                ))}
              </motion.div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
