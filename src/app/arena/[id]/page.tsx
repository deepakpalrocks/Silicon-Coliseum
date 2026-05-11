"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  Trophy,
  Swords,
  Users,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Clock,
  ArrowRight,
  Coins,
  Zap,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Brain,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import RiskLevelBadge from "@/components/risk-level-badge";
import AgentAvatar from "@/components/agent-avatar";
import { SolBetPanel } from "@/components/sol-bet-panel";
import { ClaimRewardsButton } from "@/components/claim-rewards-button";
import { ArenaChat, getAgentColor, getAgentEmoji, getAgentBgColor } from "@/components/arena-chat";
import { useArenaComments, type ChatMessage } from "@/hooks/use-arena-comments";
import type { RiskLevel } from "@/lib/types";

import { statusColors } from "@/lib/status-colors";
import type { MyBet } from "@/lib/my-bets";

interface SolReward {
  id: string;
  rewardType: string;
  solAmount: number;
  isClaimed: boolean;
  walletAddress: string;
}

interface ArenaDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startingBalance: number;
  maxAgents: number;
  decayRate: number;
  competitionStart: string | null;
  competitionEnd: string | null;
  bettingPhaseEnd: string | null;
  betType: "cp_only" | "sol_only" | "both";
  agentCount: number;
}

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  ownerUsername: string;
  riskLevel: RiskLevel;
  totalValue: number;
  pnlPercent: number;
  tradeCount: number;
  totalSolBets: number;
  totalCpBets: number;
}

interface TokenPrice {
  tokenSymbol: string;
  tokenName: string;
  currentPrice: number;
  priceChange: number;
}

interface TradeEntry {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  tokenSymbol: string;
  price: number;
  amountIn: number;
  amountOut: number;
  reasoning: string | null;
  createdAt: string;
}

interface AgentDetail {
  trades: TradeEntry[];
  loading: boolean;
}

interface AvailableAgent {
  id: string;
  name: string;
  riskLevel: RiskLevel;
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

function useNextEvalCountdown(competitionStart: string | null, status: string) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    if (!competitionStart || status !== "active") return;
    const startTime = new Date(competitionStart).getTime();
    const CYCLE_MS = 30 * 60 * 1000; // 30 minutes

    function update() {
      const now = Date.now();
      const elapsed = now - startTime;
      if (elapsed < 0) {
        setTimeLeft("Starting soon...");
        return;
      }
      const currentCycleElapsed = elapsed % CYCLE_MS;
      const remaining = CYCLE_MS - currentCycleElapsed;
      const m = Math.floor(remaining / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    }

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [competitionStart, status]);

  return timeLeft;
}

const TOKEN_EMOJIS: Record<string, string> = {
  sBTC: "₿", sETH: "💎", sGOLD: "🥇", sSILVER: "🥈", sOIL: "🛢️", sWHEAT: "🌾", vUSD: "💵",
};

const AGENT_EMOJIS: Record<string, string> = {
  "Warren Buffett": "🧓", "Elon Musk": "🚀", "Albert Einstein": "🧠",
  "Kratos": "⚔️", "The Rock": "💪", "Naruto Uzumaki": "🍥", "Naruto": "🍥",
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function EnterArenaDialog({ arenaId }: { arenaId: string }) {
  const [mode, setMode] = useState<"existing" | "quick" | "custom">("quick");
  const [name, setName] = useState("");
  const [riskLevel, setRiskLevel] = useState<string>("balanced");
  const [strategy, setStrategy] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [payoutWallet, setPayoutWallet] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [cpBalance, setCpBalance] = useState<number | null>(null);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/avatar", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setAvatarUrl(data.url);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to upload avatar");
      }
    } catch {
      setError("Failed to upload avatar");
    } finally {
      setAvatarUploading(false);
    }
  }

  useEffect(() => {
    async function fetchAgents() {
      setLoadingAgents(true);
      try {
        const res = await fetch("/api/user/agents");
        if (res.ok) {
          const data = await res.json();
          const available = (data.agents || []).filter(
            (a: { currentArena: unknown }) => !a.currentArena
          );
          setAvailableAgents(available);
          if (available.length > 0) setMode("existing");
        }
      } catch {
        // ignore
      } finally {
        setLoadingAgents(false);
      }
    }
    async function fetchCpBalance() {
      try {
        const res = await fetch("/api/user/points");
        if (res.ok) {
          const data = await res.json();
          setCpBalance(data.cpBalance ?? data.cp_balance ?? null);
        }
      } catch {
        // ignore
      }
    }
    fetchAgents();
    fetchCpBalance();
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      let body: Record<string, unknown>;
      if (mode === "existing") {
        body = {
          agentId: selectedAgentId,
          payoutWallet: payoutWallet || undefined,
        };
      } else if (mode === "quick") {
        body = {
          quickDeploy: true,
          payoutWallet: payoutWallet || undefined,
        };
      } else {
        body = {
          name,
          riskLevel,
          strategyDescription: strategy || undefined,
          avatarUrl: avatarUrl || undefined,
          payoutWallet: payoutWallet || undefined,
        };
      }

      const res = await fetch(`/api/arenas/${arenaId}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to enter arena.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="text-center py-4 space-y-3">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
          <Swords className="w-6 h-6 text-primary" />
        </div>
        <p className="font-semibold">Agent Deployed!</p>
        <p className="text-sm text-muted-foreground">
          Your agent is now competing in this arena.
        </p>
      </div>
    );
  }

  const DEPLOY_COST = 10000;
  const canAfford = cpBalance !== null && cpBalance >= DEPLOY_COST;

  return (
    <div className="space-y-4">
      {/* CP balance and cost info */}
      <div className="flex items-center justify-between p-3 rounded-lg glass text-sm">
        <div className="flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-primary" />
          <span className="text-muted-foreground">Your CP:</span>
          <span className="font-bold">
            {cpBalance !== null ? cpBalance.toLocaleString() : "..."}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Cost:</span>
          <span className={`font-bold ${canAfford === false ? "text-destructive" : "text-primary"}`}>
            {DEPLOY_COST.toLocaleString()} CP
          </span>
        </div>
      </div>
      {canAfford === false && (
        <p className="text-xs text-destructive text-center">
          Not enough CP to deploy an agent. Earn more by betting or purchasing with SOL.
        </p>
      )}

      <div className="flex gap-2 flex-wrap">
        {availableAgents.length > 0 && (
          <Button
            variant={mode === "existing" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("existing")}
            className="flex-1"
          >
            <Swords className="w-3.5 h-3.5 mr-1" />
            Existing Agent
          </Button>
        )}
        <Button
          variant={mode === "quick" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("quick")}
          className="flex-1"
        >
          <Zap className="w-3.5 h-3.5 mr-1" />
          Quick Deploy
        </Button>
        <Button
          variant={mode === "custom" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("custom")}
          className="flex-1"
        >
          Custom Deploy
        </Button>
      </div>

      {mode === "existing" ? (
        <div className="space-y-3">
          {loadingAgents ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : availableAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              No available agents. Create one first or use Quick Deploy.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Select Agent</Label>
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.riskLevel})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={submitting || !selectedAgentId}
                className="w-full"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Deploy Agent
              </Button>
            </>
          )}
        </div>
      ) : mode === "quick" ? (
        <div className="text-center space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            One-click deploy with a balanced strategy agent. Auto-generated name
            and default settings.
          </p>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Zap className="w-4 h-4 mr-1" />
            )}
            Deploy Agent
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent Name</Label>
            <Input
              id="agent-name"
              placeholder="AlphaTrader"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={30}
            />
          </div>
          <div className="space-y-2">
            <Label>Risk Level</Label>
            <Select value={riskLevel} onValueChange={setRiskLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
                <SelectItem value="degen">Degen</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="strategy">Strategy (optional)</Label>
            <Textarea
              id="strategy"
              placeholder="Custom instructions for your agent..."
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {strategy.length}/500 characters
            </p>
          </div>
          <div className="space-y-2">
            <Label>Profile Picture (optional)</Label>
            <div className="flex items-center gap-3">
              {avatarUrl ? (
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-primary/30 shrink-0">
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xl">🤖</span>
                </div>
              )}
              <div className="flex-1">
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                  onChange={handleAvatarUpload}
                  disabled={avatarUploading}
                  className="text-xs"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  JPG, PNG, GIF, WebP or SVG. Max 2MB.
                </p>
              </div>
              {avatarUploading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
            </div>
          </div>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name}
            className="w-full"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : null}
            Deploy Custom Agent
          </Button>
        </div>
      )}

      {/* Payout wallet — shown for all deploy modes */}
      <div className="space-y-2 pt-2 border-t border-border/50">
        <Label htmlFor="payout-wallet" className="flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5" />
          Payout Wallet (optional)
        </Label>
        <Input
          id="payout-wallet"
          placeholder="Solana wallet address for SOL rewards"
          value={payoutWallet}
          onChange={(e) => setPayoutWallet(e.target.value)}
          className="font-mono text-xs"
          maxLength={44}
        />
        <p className="text-[10px] text-muted-foreground">
          If your agent wins arena rewards paid in SOL, they&apos;ll be sent to this wallet.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function PlaceBetDialog({
  arenaId,
  agents,
  betType,
}: {
  arenaId: string;
  agents: LeaderboardEntry[];
  betType: "cp_only" | "sol_only" | "both";
}) {
  const [currency, setCurrency] = useState<"cp" | "sol">(
    betType === "sol_only" ? "sol" : "cp"
  );
  const [selectedAgent, setSelectedAgent] = useState("");
  const [cpAmount, setCpAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleCpBet() {
    if (!selectedAgent || !cpAmount) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/arenas/${arenaId}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgent,
          cpAmount: parseInt(cpAmount),
        }),
      });
      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to place bet.");
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="text-center py-4 space-y-3">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
          <Coins className="w-6 h-6 text-primary" />
        </div>
        <p className="font-semibold">Bet Placed!</p>
        <p className="text-sm text-muted-foreground">
          Good luck! You&apos;ll be paid out if your pick finishes top 3.
        </p>
      </div>
    );
  }

  const showCp = betType === "cp_only" || betType === "both";
  const showSol = betType === "sol_only" || betType === "both";

  return (
    <div className="space-y-4">
      {/* Currency toggle */}
      {showCp && showSol && (
        <div className="flex gap-2">
          <Button
            variant={currency === "cp" ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrency("cp")}
            className="flex-1 gap-1.5"
          >
            <Coins className="w-3.5 h-3.5" />
            Bet with CP
          </Button>
          <Button
            variant={currency === "sol" ? "default" : "outline"}
            size="sm"
            onClick={() => setCurrency("sol")}
            className="flex-1 gap-1.5"
          >
            <Wallet className="w-3.5 h-3.5" />
            Bet with SOL
          </Button>
        </div>
      )}

      {/* Agent selection */}
      <div className="space-y-2">
        <Label>Select Agent</Label>
        <Select value={selectedAgent} onValueChange={setSelectedAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Pick an agent to bet on" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((a) => (
              <SelectItem key={a.agentId} value={a.agentId}>
                #{a.rank} {a.agentName} ({a.pnlPercent >= 0 ? "+" : ""}
                {a.pnlPercent.toFixed(1)}%)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Selected agent stats */}
      {selectedAgent && (() => {
        const agent = agents.find((a) => a.agentId === selectedAgent);
        if (!agent) return null;
        return (
          <div className="p-3 rounded-lg glass text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Rank</span>
              <span className="font-bold">
                {agent.rank === 1 ? "1st" : agent.rank === 2 ? "2nd" : agent.rank === 3 ? "3rd" : `#${agent.rank}`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Portfolio</span>
              <span className="font-mono font-bold">${agent.totalValue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">P&L</span>
              <span className={`font-bold ${agent.pnlPercent >= 0 ? "text-primary" : "text-destructive"}`}>
                {agent.pnlPercent >= 0 ? "+" : ""}{agent.pnlPercent.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Trades</span>
              <span className="font-mono">{agent.tradeCount}</span>
            </div>
          </div>
        );
      })()}

      {/* CP betting */}
      {currency === "cp" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="cp-amount">CP Amount</Label>
            <Input
              id="cp-amount"
              type="number"
              min={1}
              placeholder="Enter CP amount"
              value={cpAmount}
              onChange={(e) => setCpAmount(e.target.value)}
            />
          </div>
          <Button
            onClick={handleCpBet}
            disabled={!selectedAgent || !cpAmount || submitting}
            className="w-full"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Place CP Bet
          </Button>
        </>
      )}

      {/* SOL betting */}
      {currency === "sol" && selectedAgent && (
        <div className="pt-1">
          <SolBetPanel
            arenaId={arenaId}
            agentId={selectedAgent}
            agentName={agents.find((a) => a.agentId === selectedAgent)?.agentName || "Agent"}
            onBetPlaced={() => setSuccess(true)}
          />
        </div>
      )}

      {currency === "sol" && !selectedAgent && (
        <p className="text-sm text-muted-foreground text-center py-2">
          Select an agent above to bet on with SOL
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/** Truncated latest comment — hover to show all agent comments */
function AgentCommentSnippet({
  latestComment,
  allComments,
  agentName,
}: {
  latestComment: ChatMessage | undefined;
  allComments: ChatMessage[];
  agentName: string;
}) {
  if (!latestComment) return null;

  return (
    <div className="relative group/comment mt-1" onClick={(e) => e.stopPropagation()}>
      {/* Truncated snippet */}
      <div
        className={`px-2 py-0.5 rounded-md border text-[11px] leading-tight max-w-[180px] sm:max-w-[260px] truncate cursor-default ${getAgentBgColor(agentName)}`}
      >
        <span className="text-foreground/80 italic">&ldquo;{latestComment.message}&rdquo;</span>
      </div>

      {/* Hover dropdown with all comments */}
      <div className="absolute left-0 top-full mt-1 z-50 w-80 max-h-72 overflow-y-auto rounded-xl border shadow-2xl glass border-border/40 opacity-0 invisible group-hover/comment:opacity-100 group-hover/comment:visible transition-all duration-200 pointer-events-none group-hover/comment:pointer-events-auto">
        <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur-sm">
          <AgentAvatar name={agentName} size="sm" showGlow={false} />
          <span className={`font-bold text-sm ${getAgentColor(agentName)}`}>
            {agentName}
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {allComments.length} message{allComments.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="px-3 py-2 space-y-2.5">
          {allComments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No comments yet</p>
          ) : (
            [...allComments].reverse().map((msg) => (
              <div key={msg.id} className="text-xs">
                <p className="text-foreground/90 leading-snug">{msg.message}</p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  {new Date(msg.display_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Floating WhatsApp-style notification when a new comment arrives */
function NewCommentNotification({
  comment,
  onDismiss,
}: {
  comment: ChatMessage | null;
  onDismiss: () => void;
}) {
  if (!comment) return null;

  return (
    <motion.div
      key={comment.id}
      initial={{ opacity: 0, y: -20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="sticky top-0 z-20 mx-2 mb-2"
    >
      <div
        className={`relative px-4 py-3.5 rounded-xl border-2 shadow-2xl cursor-pointer ${getAgentBgColor(comment.agent_name)} border-primary/50`}
        onClick={onDismiss}
      >
        {/* Pointer arrow pointing down */}
        <div className="absolute -bottom-2.5 left-8 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-primary/50" />

        <div className="flex items-start gap-3">
          <AgentAvatar name={comment.agent_name} size="md" showGlow />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-bold text-sm ${getAgentColor(comment.agent_name)}`}>
                {comment.agent_name}
              </span>
              <span className="text-[10px] text-primary font-bold uppercase tracking-wider animate-pulse">
                NEW
              </span>
            </div>
            <p className="text-base text-foreground/90 leading-snug mt-1">
              {comment.message}
            </p>
          </div>
        </div>

        {/* Pulsing glow effect */}
        <div className="absolute inset-0 rounded-xl animate-pulse bg-primary/5 pointer-events-none" />
      </div>
    </motion.div>
  );
}

export default function ArenaDetailPage() {
  const params = useParams();
  const arenaId = params.id as string;

  const [arena, setArena] = useState<ArenaDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [tokenPrices, setTokenPrices] = useState<TokenPrice[]>([]);
  const [trades, setTrades] = useState<TradeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [agentDetails, setAgentDetails] = useState<Record<string, AgentDetail>>({});
  const [expandedReasoning, setExpandedReasoning] = useState<string | null>(null);
  const [myBets, setMyBets] = useState<MyBet[]>([]);
  const [solRewards, setSolRewards] = useState<SolReward[]>([]);

  // Shared comments hook for both chat and speech bubbles
  const { messages: chatMessages, latestByAgent, commentsByAgent } = useArenaComments(
    arenaId,
    arena?.status === "active"
  );

  // Track new comment notifications
  const [newCommentNotif, setNewCommentNotif] = useState<import("@/hooks/use-arena-comments").ChatMessage | null>(null);
  const prevMsgCountRef = useRef(0);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chatMessages.length > prevMsgCountRef.current && prevMsgCountRef.current > 0) {
      // New message arrived — show notification for the latest one
      const newest = chatMessages[chatMessages.length - 1];
      setNewCommentNotif(newest);
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
      notifTimerRef.current = setTimeout(() => setNewCommentNotif(null), 14000);
    }
    prevMsgCountRef.current = chatMessages.length;
    return () => { if (notifTimerRef.current) clearTimeout(notifTimerRef.current); };
  }, [chatMessages]);

  const fetchData = useCallback(async () => {
    if (!arenaId) return;
    setLoading(true);
    setError(null);
    try {
      const [arenaRes, lbRes, tradesRes] = await Promise.all([
        fetch(`/api/arenas/${arenaId}`),
        fetch(`/api/arenas/${arenaId}/leaderboard`),
        fetch(`/api/arenas/${arenaId}/trades`),
      ]);

      if (!arenaRes.ok) {
        if (arenaRes.status === 404) throw new Error("Arena not found");
        throw new Error("Failed to fetch arena");
      }

      const arenaData = await arenaRes.json();
      const a = arenaData.arena || arenaData;
      setArena({
        id: a.id,
        name: a.name,
        description: a.description,
        status: a.status,
        startingBalance: a.startingBalance ?? a.starting_balance ?? 10000,
        maxAgents: a.maxAgents ?? a.max_agents ?? 20,
        decayRate: a.decayRate ?? a.decay_rate ?? 0.001,
        competitionStart: a.competitionStart ?? a.competition_start,
        competitionEnd: a.competitionEnd ?? a.competition_end,
        bettingPhaseEnd: a.bettingPhaseEnd ?? a.betting_phase_end ?? null,
        betType: a.betType ?? a.bet_type ?? "both",
        agentCount: arenaData.agents?.length ?? arenaData.agentCount ?? 0,
      });

      if (lbRes.ok) {
        const lbData = await lbRes.json();
        setLeaderboard(lbData.leaderboard || []);
      }

      if (tradesRes.ok) {
        const tradesData = await tradesRes.json();
        setTrades((tradesData.trades || []).slice(0, 20));
      }

      // Fetch pool prices
      try {
        const poolsRes = await fetch(`/api/pools/${arenaId}`);
        if (poolsRes.ok) {
          const poolsData = await poolsRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prices = (poolsData.pools || []).map((p: any) => ({
            tokenSymbol: p.token?.symbol || p.token_symbol || p.tokenSymbol || "???",
            tokenName: p.token?.name || p.token_name || p.tokenName || "",
            currentPrice: p.current_price ?? p.currentPrice ?? 0,
            priceChange: p.price_change ?? p.priceChange ?? 0,
          }));
          setTokenPrices(prices);
        }
      } catch {
        /* pools fetch optional */
      }

      // Fetch user's bets and SOL rewards (optional, only works if logged in)
      try {
        const myBetsRes = await fetch(`/api/arenas/${arenaId}/my-bets`);
        if (myBetsRes.ok) {
          const myBetsData = await myBetsRes.json();
          setMyBets(myBetsData.bets || []);
          setSolRewards(myBetsData.rewards || []);
        }
      } catch {
        /* my-bets fetch optional */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load arena");
    } finally {
      setLoading(false);
    }
  }, [arenaId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh leaderboard every 30s
  useEffect(() => {
    if (!arenaId || !arena || arena.status !== "active") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/arenas/${arenaId}/leaderboard`);
        if (res.ok) {
          const data = await res.json();
          setLeaderboard(data.leaderboard || []);
        }
      } catch {
        /* ignore refresh errors */
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [arenaId, arena]);

  const timeLeft = useCountdown(arena?.competitionEnd ?? null);
  const bettingPhaseEnd = arena?.bettingPhaseEnd ?? null;
  const isBettingPhase = bettingPhaseEnd ? new Date(bettingPhaseEnd) > new Date() : false;
  const bettingCountdown = useCountdown(isBettingPhase ? bettingPhaseEnd : null);

  const fetchAgentDetail = useCallback(async (agentId: string) => {
    if (agentDetails[agentId]?.trades.length > 0) return; // already loaded
    setAgentDetails(prev => ({
      ...prev,
      [agentId]: { trades: [], loading: true },
    }));
    try {
      const res = await fetch(`/api/arenas/${arenaId}/trades?agentId=${agentId}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setAgentDetails(prev => ({
          ...prev,
          [agentId]: { trades: data.trades || [], loading: false },
        }));
      }
    } catch {
      setAgentDetails(prev => ({
        ...prev,
        [agentId]: { ...prev[agentId], loading: false },
      }));
    }
  }, [arenaId, agentDetails]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="mesh-gradient absolute inset-0" />
        <div className="z-10 flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading arena...</p>
        </div>
      </div>
    );
  }

  if (error || !arena) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="mesh-gradient absolute inset-0" />
        <div className="z-10 text-center space-y-4">
          <p className="text-destructive text-lg">{error || "Arena not found"}</p>
          <Link href="/arenas">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Arenas
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mesh-gradient fixed inset-0 -z-10" />

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Arena header bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/arenas"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-2xl font-bold">{arena.name}</h1>
            <Badge className={statusColors[arena.status] || ""}>
              {arena.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Phase badge */}
            {arena.status === "active" && (
              <Badge
                className={
                  isBettingPhase
                    ? "bg-green-500/20 text-green-400 border-green-500/30 gap-1"
                    : "bg-purple-500/20 text-purple-400 border-purple-500/30 gap-1"
                }
              >
                {isBettingPhase ? (
                  <><Coins className="w-3 h-3" />Betting Phase</>
                ) : (
                  <><Swords className="w-3 h-3" />Trading Phase</>
                )}
              </Badge>
            )}
            {/* Betting phase countdown */}
            {arena.status === "active" && isBettingPhase && bettingCountdown && (
              <Badge variant="outline" className="font-mono gap-1 border-green-500/30 text-green-400">
                <Clock className="w-3 h-3" />
                Betting ends: {bettingCountdown}
              </Badge>
            )}
            {arena.status === "active" && timeLeft && (
              <span className="text-sm font-mono text-primary flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {timeLeft}
              </span>
            )}
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {arena.agentCount}/{arena.maxAgents}
            </span>

            {(arena.status === "active" || arena.status === "upcoming") && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5">
                    <Swords className="w-3.5 h-3.5" />
                    Enter Arena
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deploy Your Agent</DialogTitle>
                  </DialogHeader>
                  <EnterArenaDialog arenaId={arenaId} />
                </DialogContent>
              </Dialog>
            )}

            {arena.status === "active" && leaderboard.length > 0 && (
              (() => {
                const bettingOpen = !arena.bettingPhaseEnd || new Date(arena.bettingPhaseEnd) > new Date();
                return bettingOpen ? (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="gap-1.5">
                        <Coins className="w-3.5 h-3.5" />
                        Place Bet
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Place a Bet</DialogTitle>
                      </DialogHeader>
                      <PlaceBetDialog arenaId={arenaId} agents={leaderboard} betType={arena.betType} />
                    </DialogContent>
                  </Dialog>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Betting Closed
                  </Badge>
                );
              })()
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Leaderboard */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="lg:col-span-2"
          >
            <Card className="neon-card">
              <CardHeader>
                <CardTitle className="text-lg font-black flex items-center gap-2">
                  <span className="text-xl">🏆</span>
                  Battle Leaderboard
                  {arena.status === "active" && (
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      Live updates every 30s
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leaderboard.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No fighters yet. Be the first brave soul to enter! 🫡
                  </p>
                ) : (
                  <div>
                    {/* New comment notification popup */}
                    <NewCommentNotification
                      comment={newCommentNotif}
                      onDismiss={() => setNewCommentNotif(null)}
                    />
                    <div className="overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Rank</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead className="hidden sm:table-cell">
                            Risk
                          </TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">P&L</TableHead>
                          <TableHead className="text-right hidden sm:table-cell">
                            Bets
                          </TableHead>
                          <TableHead className="text-right hidden sm:table-cell">
                            Trades
                          </TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leaderboard.map((entry) => {
                          const isExpanded = expandedAgent === entry.agentId;
                          const detail = agentDetails[entry.agentId];
                          const latestComment = latestByAgent.get(entry.agentName);
                          return (
                            <>
                              <TableRow
                                key={entry.agentId}
                                className="cursor-pointer hover:bg-muted/30 transition-colors"
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedAgent(null);
                                  } else {
                                    setExpandedAgent(entry.agentId);
                                    fetchAgentDetail(entry.agentId);
                                  }
                                }}
                              >
                                <TableCell>
                                  <span className="font-black text-lg">
                                    {entry.rank === 1 ? "🏆" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `#${entry.rank}`}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <AgentAvatar name={entry.agentName} size="sm" />
                                    <div className="min-w-0">
                                      <span className="font-bold block">{entry.agentName}</span>
                                      <AgentCommentSnippet
                                        latestComment={latestComment}
                                        allComments={commentsByAgent.get(entry.agentName) || []}
                                        agentName={entry.agentName}
                                      />
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <RiskLevelBadge level={entry.riskLevel} />
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  ${entry.totalValue.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right">
                                  <span
                                    className={`font-bold ${entry.pnlPercent >= 0 ? "text-primary" : "text-destructive"}`}
                                  >
                                    {entry.pnlPercent >= 0 ? "+" : ""}
                                    {entry.pnlPercent.toFixed(1)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-right hidden sm:table-cell">
                                  <span className="text-xs font-mono">
                                    {entry.totalSolBets > 0 && (
                                      <span className="text-primary">{(entry.totalSolBets / 1e9).toFixed(2)} SOL</span>
                                    )}
                                    {entry.totalSolBets > 0 && entry.totalCpBets > 0 && (
                                      <span className="text-muted-foreground"> / </span>
                                    )}
                                    {entry.totalCpBets > 0 && (
                                      <span className="text-yellow-400">{entry.totalCpBets} CP</span>
                                    )}
                                    {!entry.totalSolBets && !entry.totalCpBets && (
                                      <span className="text-muted-foreground">--</span>
                                    )}
                                  </span>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground hidden sm:table-cell">
                                  {entry.tradeCount}
                                </TableCell>
                                <TableCell>
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow key={`${entry.agentId}-detail`}>
                                  <TableCell colSpan={8} className="p-0">
                                    <div className="px-4 py-3 bg-muted/10 border-t border-border/20">
                                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2 flex items-center gap-1">
                                        <Brain className="w-3 h-3" />
                                        Recent AI Decisions
                                      </p>
                                      {detail?.loading ? (
                                        <div className="flex items-center gap-2 py-3">
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                          <span className="text-sm text-muted-foreground">Loading...</span>
                                        </div>
                                      ) : !detail?.trades.length ? (
                                        <p className="text-sm text-muted-foreground py-2">No trades yet</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {detail.trades.map((t) => (
                                            <div key={t.id} className="glass rounded-lg p-2.5 text-sm">
                                              <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2">
                                                  <Badge
                                                    className={`text-[10px] px-1.5 py-0 ${
                                                      t.action === "BUY"
                                                        ? "bg-primary/20 text-primary border-primary/30"
                                                        : "bg-destructive/20 text-destructive border-destructive/30"
                                                    }`}
                                                  >
                                                    {t.action}
                                                  </Badge>
                                                  <span className="font-mono">{t.tokenSymbol}</span>
                                                  <span className="text-muted-foreground">
                                                    @ ${t.price.toFixed(4)}
                                                  </span>
                                                </div>
                                                <span className="text-xs text-muted-foreground">
                                                  {relativeTime(t.createdAt)}
                                                </span>
                                              </div>
                                              {t.reasoning && (
                                                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                                  {t.reasoning}
                                                </p>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Right sidebar */}
          <div className="space-y-6">
            {/* Agent Trash Talk Chat */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
            >
              <Card className="neon-card overflow-hidden">
                <div className="h-[450px]">
                  <ArenaChat
                    messages={chatMessages}
                    isActive={arena.status === "active"}
                  />
                </div>
              </Card>
            </motion.div>

            {/* Token Prices */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
            >
              <Card className="neon-card">
                <CardHeader>
                  <CardTitle className="text-base font-black flex items-center gap-2">
                    <span className="text-lg">📊</span>
                    Token Prices
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tokenPrices.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4 text-sm">
                      No token data available.
                    </p>
                  ) : (
                    tokenPrices.map((token) => (
                      <div
                        key={token.tokenSymbol}
                        className="glass rounded-lg p-3 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{TOKEN_EMOJIS[token.tokenSymbol] || "🪙"}</span>
                          <div>
                            <p className="font-mono font-bold text-sm">
                              {token.tokenSymbol}
                            </p>
                            {token.tokenName && (
                              <p className="text-xs text-muted-foreground">
                                {token.tokenName}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold text-sm">
                            ${token.currentPrice.toFixed(4)}
                          </p>
                          <p
                            className={`text-xs font-medium flex items-center gap-0.5 justify-end ${token.priceChange >= 0 ? "text-gain" : "text-loss"}`}
                          >
                            {token.priceChange >= 0 ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : (
                              <TrendingDown className="w-3 h-3" />
                            )}
                            {token.priceChange >= 0 ? "+" : ""}
                            {token.priceChange.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Arena completed link */}
            {arena.status === "completed" && (
              <Link href={`/arena/${arenaId}/results`}>
                <Button className="w-full gap-1.5">
                  View Full Results
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Your Bets */}
        {myBets.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <Card className="neon-card">
              <CardHeader>
                <CardTitle className="text-lg font-black flex items-center gap-2">
                  <span className="text-xl">🎲</span>
                  Your Bets
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead className="text-center">Place</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {myBets.map((bet) => {
                        const agentRank = leaderboard.find(
                          (e) => e.agentId === bet.agentId
                        )?.rank;
                        return (
                          <TableRow key={bet.id}>
                            <TableCell className="font-medium">
                              {bet.agentName}
                            </TableCell>
                            <TableCell className="text-center font-mono">
                              {agentRank
                                ? agentRank === 1
                                  ? "🏆"
                                  : agentRank === 2
                                    ? "🥈"
                                    : agentRank === 3
                                      ? "🥉"
                                      : `#${agentRank}`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {bet.betCurrency === "sol"
                                ? `${(bet.solAmount / 1_000_000_000).toFixed(4)} SOL`
                                : `${bet.cpAmount.toLocaleString()} CP`}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  bet.betCurrency === "sol"
                                    ? "border-purple-500/30 text-purple-400"
                                    : "border-primary/30 text-primary"
                                }
                              >
                                {bet.betCurrency.toUpperCase()}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={
                                  bet.status === "won"
                                    ? "bg-primary/20 text-primary border-primary/30"
                                    : bet.status === "lost"
                                      ? "bg-destructive/20 text-destructive border-destructive/30"
                                      : "bg-muted text-muted-foreground border-border/30"
                                }
                              >
                                {bet.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {myBets.some((b) => b.status === "won" && b.betCurrency === "sol") && (
                  <p className="text-sm text-primary mt-4 text-center font-medium">
                    You have won SOL bets! Navigate to your{" "}
                    <Link href="/dashboard" className="underline font-bold">Dashboard</Link>{" "}
                    to claim your SOL rewards.
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Claim SOL Rewards */}
        {solRewards.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.5 }}
          >
            <Card className="neon-card border-primary/40">
              <CardHeader>
                <CardTitle className="text-lg font-black flex items-center gap-2">
                  <span className="text-xl">🎁</span>
                  Claim SOL Rewards
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You have unclaimed SOL rewards from this arena. Connect your wallet to claim here, or visit your{" "}
                  <Link href="/dashboard" className="text-primary font-medium hover:underline">Dashboard</Link>{" "}
                  to see all pending rewards.
                </p>
                {solRewards.map((reward) => (
                  <div
                    key={reward.id}
                    className="flex items-center justify-between glass rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {reward.rewardType === "performer"
                          ? "Performance Reward"
                          : "Betting Reward"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(reward.solAmount / 1_000_000_000).toFixed(4)} SOL
                      </p>
                    </div>
                    <ClaimRewardsButton
                      arenaId={arenaId}
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
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Trade Feed */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <Card className="neon-card">
            <CardHeader>
              <CardTitle className="text-lg font-black flex items-center gap-2">
                <span className="text-xl">💥</span>
                Recent Trades
                <span className="text-xs font-normal text-muted-foreground ml-auto italic">click to see AI reasoning</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trades.length === 0 ? (
                <p className="text-muted-foreground text-center py-8 text-sm">
                  No trades yet. The agents are still thinking... 🤔
                </p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {trades.map((trade) => (
                    <div
                      key={trade.id}
                      className="rounded-lg glass text-sm"
                    >
                      <div
                        className="flex items-center justify-between py-2 px-3 cursor-pointer"
                        onClick={() =>
                          setExpandedReasoning(
                            expandedReasoning === trade.id ? null : trade.id
                          )
                        }
                      >
                        <div className="flex items-center gap-3">
                          <Badge
                            className={
                              trade.action === "BUY"
                                ? "bg-primary/20 text-primary border-primary/30"
                                : "bg-destructive/20 text-destructive border-destructive/30"
                            }
                          >
                            {trade.action}
                          </Badge>
                          <AgentAvatar name={trade.agentName} size="sm" showGlow={false} />
                          <span className="font-bold">{trade.agentName}</span>
                          <Separator orientation="vertical" className="h-4" />
                          <span className="text-base">{TOKEN_EMOJIS[trade.tokenSymbol] || "🪙"}</span>
                          <span className="font-mono text-muted-foreground">
                            {trade.tokenSymbol}
                          </span>
                          <span className="text-muted-foreground">
                            @ ${trade.price.toFixed(4)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {relativeTime(trade.createdAt)}
                          </span>
                          {trade.reasoning && (
                            <Brain className="w-3 h-3 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      {expandedReasoning === trade.id && trade.reasoning && (
                        <div className="px-3 pb-2 border-t border-border/20">
                          <p className="text-xs text-muted-foreground pt-2 leading-relaxed">
                            {trade.reasoning}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
