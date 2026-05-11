// ============================================================================
// Silicon Coliseum — Core Types (Arena-First Model)
// ============================================================================

// --- User & Auth ---

export interface User {
  id: string;
  authId: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  walletAddress: string | null;
  isAdmin: boolean;
  cpBalance: number;
  createdAt: string;
}

// --- Platform Tokens ---

export interface PlatformToken {
  id: string;
  symbol: string;
  name: string;
  imageUrl: string | null;
  description: string | null;
  isBaseCurrency: boolean;
  createdAt: string;
}

// --- Arena ---

export type ArenaStatus = "upcoming" | "active" | "completed" | "cancelled";

export type ArenaBetType = "cp_only" | "sol_only" | "both";

export interface Arena {
  id: string;
  name: string;
  description: string | null;
  status: ArenaStatus;
  startingBalance: number;
  maxAgents: number;
  decayRate: number;
  competitionStart: string | null;
  competitionEnd: string | null;
  bettingPhaseEnd: string | null;
  betType: ArenaBetType;
  createdBy: string | null;
  createdAt: string;
}

export interface ArenaToken {
  id: string;
  arenaId: string;
  tokenId: string;
}

// --- AMM Pools ---

export interface Pool {
  id: string;
  arenaId: string;
  tokenId: string;
  baseTokenId: string;
  reserveToken: number;
  reserveBase: number;
  feeRate: number;
  totalVolume: number;
}

export interface PoolSnapshot {
  id: string;
  poolId: string;
  price: number;
  reserveToken: number;
  reserveBase: number;
  volume: number;
  createdAt: string;
}

// --- Agents ---

export type RiskLevel = "conservative" | "balanced" | "aggressive" | "degen";
export type AgentStatus = "active" | "eliminated" | "finished";

export interface Agent {
  id: string;
  userId: string;
  arenaId: string | null;
  name: string;
  riskLevel: RiskLevel;
  strategyDescription: string | null;
  avatarUrl: string | null;
  cashBalance: number;
  status: AgentStatus;
  totalArenas: number;
  totalWins: number;
  bestPnl: number;
  createdAt: string;
}

export interface ArenaEntryRecord {
  id: string;
  arenaId: string;
  agentId: string;
  cashBalance: number;
  status: AgentStatus;
  createdAt: string;
}

// --- Arena Balances & Trades ---

export interface ArenaBalance {
  id: string;
  arenaId: string;
  agentId: string;
  tokenId: string;
  amount: number;
}

export type TradeAction = "BUY" | "SELL";

export interface ArenaTrade {
  id: string;
  arenaId: string;
  poolId: string;
  agentId: string;
  action: TradeAction;
  tokenId: string;
  amountIn: number;
  amountOut: number;
  price: number;
  fee: number;
  reasoning: string | null;
  createdAt: string;
}

// --- Arena Results ---

export interface ArenaResult {
  id: string;
  arenaId: string;
  agentId: string;
  userId: string;
  finalRank: number;
  finalValue: number;
  pnlPercent: number;
  rewardCp: number;
  tradeCount: number;
}

// --- Betting ---

export type BetStatus = "pending" | "won" | "lost";
export type BetCurrency = "cp" | "sol";

export interface Bet {
  id: string;
  arenaId: string;
  userId: string;
  agentId: string;
  cpAmount: number;
  solAmount: number;
  betCurrency: BetCurrency;
  txSignature: string | null;
  walletAddress: string | null;
  status: BetStatus;
  payout: number;
  createdAt: string;
}

// --- SOL Rewards ---

export type SolRewardType = "performer" | "bettor";

export interface SolReward {
  id: string;
  arenaId: string;
  userId: string;
  walletAddress: string;
  rewardType: SolRewardType;
  solAmount: number;
  isClaimed: boolean;
  claimTx: string | null;
  createdAt: string;
  claimedAt: string | null;
}

// --- SOL Transactions ---

export type SolTxType = "buy_cp" | "place_bet" | "cancel_bet" | "claim_reward";

export interface SolTransaction {
  id: string;
  userId: string;
  walletAddress: string;
  txSignature: string;
  txType: SolTxType;
  solAmount: number;
  cpAmount: number | null;
  arenaId: string | null;
  agentId: string | null;
  status: "pending" | "confirmed" | "failed";
  createdAt: string;
}

// --- Coliseum Points ---

export type CpTransactionType = "earn" | "spend" | "payout";

export interface CpTransaction {
  id: string;
  userId: string;
  amount: number;
  type: CpTransactionType;
  source: string;
  arenaId: string | null;
  createdAt: string;
}

// --- User Profiles ---

export interface UserProfile {
  id: string;
  userId: string;
  totalArenas: number;
  wins: number;
  top3Finishes: number;
  bestPnl: number;
  totalTrades: number;
}

// --- Leaderboard ---

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  ownerUsername: string;
  riskLevel: RiskLevel;
  totalValue: number;
  pnlPercent: number;
  tradeCount: number;
  cashBalance: number;
  totalSolBets: number;
  totalCpBets: number;
}

// --- AI Decision Types ---

export interface AIAction {
  action: "BUY" | "SELL" | "HOLD";
  tokenSymbol: string;
  amountVusd: number;
  confidence: number;
  reasoning: string;
}

export interface AIDecision {
  actions: AIAction[];
}

// ============================================================================
// Legacy compatibility aliases (used by existing pages/components/tests)
// ============================================================================

/** @deprecated Use ArenaStatus instead */
export type ArenaPhase = "prep" | "competition" | "challenge" | "rewards" | "closed";

/** @deprecated Legacy swap result shape */
export interface SwapResult {
  amountOut: number;
  fee: number;
  priceImpact: number;
  executionPrice: number;
  newReserveIn: number;
  newReserveOut: number;
}

/** @deprecated Legacy NPC config */
export interface NpcConfig {
  strategy: "random_walk" | "mean_reversion" | "volume_injection";
  tradeFrequency: number;
  maxTradeSize: number;
  volatilityTarget: number;
}

/** @deprecated Legacy pool analysis for AI context */
export interface PoolAnalysis {
  poolId: string;
  tokenA: string;
  tokenB: string;
  currentPrice: number;
  priceChange1h: number;
  priceChange24h: number;
  momentum: number;
  volatility: number;
  volume24h: number;
  liquidityDepth: number;
  narrative: string;
}

/** @deprecated Legacy arena AI decision response */
export interface ArenaAIDecisionResponse {
  should_trade: boolean;
  reasoning: string;
  market_analysis: string;
  actions: ArenaTradeAction[];
}

/** @deprecated Legacy arena trade action */
export interface ArenaTradeAction {
  pool_id: string;
  token_in: string;
  token_out: string;
  amount_in: number;
  reason: string;
}

/** @deprecated Legacy types for backward compat */
export interface Holding {
  id: string;
  agent_id: string;
  token: string;
  amount: number;
  avg_buy_price: number;
}

/** @deprecated Legacy trade type */
export interface Trade {
  id: string;
  agent_id: string;
  action: "BUY" | "SELL";
  token: string;
  amount_usd: number;
  price: number;
  token_amount: number;
  confidence: number;
  reasoning: string;
  created_at: string;
}

/** @deprecated Legacy decision type */
export interface Decision {
  id: string;
  agent_id: string;
  should_trade: boolean;
  reasoning: string;
  market_analysis: string;
  raw_json: unknown;
  created_at: string;
}

/** @deprecated Legacy share token */
export interface ShareToken {
  id: string;
  agent_id: string;
  token: string;
  created_at: string;
}

/** @deprecated Legacy token info */
export interface TokenInfo {
  symbol: string;
  name: string;
  chain: string;
  searchQuery: string;
  icon?: string;
}

/** @deprecated Legacy market data */
export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  fdv: number;
}

/** @deprecated Legacy sentiment data */
export interface SentimentData {
  token: string;
  sentimentScore: number;
  buzzLevel: number;
  keyThemes: string[];
  summary: string;
}

/** @deprecated Legacy AI trade action */
export interface AITradeAction {
  action: "BUY" | "SELL";
  token: string;
  amount_usd: number;
  confidence: number;
  urgency: "low" | "medium" | "high";
  reason: string;
}

/** @deprecated Legacy AI decision response */
export interface AIDecisionResponse {
  should_trade: boolean;
  reasoning: string;
  market_analysis: string;
  actions: AITradeAction[];
}

/** @deprecated Legacy arena entry */
export interface ArenaEntry {
  id: string;
  arena_id: string;
  agent_id: string;
  user_id: string;
  is_npc: boolean;
  status: "registered" | "active" | "eliminated" | "finished";
  created_at: string;
}
