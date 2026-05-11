import { NextResponse, NextRequest } from "next/server";
import OpenAI from "openai";
import { createServiceClient } from "@/lib/supabase-server";
import { CELEBRITY_AGENTS } from "@/lib/celebrity-agents";

/**
 * POST /api/cron/generate-comments
 *
 * Generates a batch of 90 in-character comments from celebrity agents
 * for each active arena in trading phase. Comments are spaced 10 seconds
 * apart so the conversation unfolds over the next 15 minutes.
 *
 * Called every 15 minutes by Vercel cron. Uses Groq for generation.
 * Skips arenas still in betting phase.
 */

const grok = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROK_API_KEY || "",
});

interface CommentLine {
  agent: string;
  message: string;
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  try {
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
      const supabaseAuth = createServiceClient();
      const { data: adminUser } = await supabaseAuth
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

    // Fetch all active arenas that are past the betting phase (trading phase only)
    const { data: allArenas } = await supabase
      .from("arenas")
      .select("id, name, betting_phase_end")
      .eq("status", "active");

    const now = new Date();
    const arenas = (allArenas || []).filter((a) => {
      if (!a.betting_phase_end) return true; // no betting phase = always generate
      return new Date(a.betting_phase_end) <= now;
    });

    if (arenas.length === 0) {
      return NextResponse.json({
        message: "No active arenas in trading phase",
        generated: 0,
      });
    }

    let totalGenerated = 0;

    for (const arena of arenas) {
      // Get agents in this arena with their names
      const { data: entries } = await supabase
        .from("arena_entries")
        .select("agent_id, agents(id, name)")
        .eq("arena_id", arena.id)
        .eq("status", "active");

      if (!entries || entries.length < 2) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentMap = new Map<string, { id: string; name: string }>();
      for (const entry of entries) {
        const agent = entry.agents as unknown as { id: string; name: string };
        if (agent) {
          agentMap.set(agent.name, { id: agent.id, name: agent.name });
        }
      }

      const agentNames = Array.from(agentMap.keys());
      if (agentNames.length < 2) continue;

      // Get latest leaderboard standings for context
      const { data: lbEntries } = await supabase
        .from("arena_entries")
        .select("agent_id, cash_balance, agents(name)")
        .eq("arena_id", arena.id)
        .eq("status", "active")
        .order("cash_balance", { ascending: false });

      let standingsContext = "";
      if (lbEntries && lbEntries.length > 0) {
        const standings = lbEntries.map((e, i) => {
          const a = e.agents as unknown as { name: string };
          return `#${i + 1} ${a?.name || "Unknown"} ($${(e.cash_balance || 0).toLocaleString()})`;
        });
        standingsContext = `\n\nCurrent standings:\n${standings.join("\n")}`;
      }

      // Build personality summaries for the prompt
      // Only include personality summaries for up to 10 agents to stay within context limits
      // Pick a random subset if >10 agents, plus always include top/bottom 3
      let featuredNames = agentNames;
      if (agentNames.length > 10 && lbEntries && lbEntries.length > 0) {
        const ranked = lbEntries.map((e) => (e.agents as unknown as { name: string })?.name).filter(Boolean);
        const top3 = ranked.slice(0, 3);
        const bottom3 = ranked.slice(-3);
        const middle = ranked.slice(3, -3);
        // Shuffle middle and pick a few
        const shuffled = middle.sort(() => Math.random() - 0.5).slice(0, 4);
        featuredNames = [...new Set([...top3, ...shuffled, ...bottom3])];
      }

      const personalitySummaries = featuredNames
        .map((name) => {
          const celeb = CELEBRITY_AGENTS.find(
            (c) => c.name === name || c.displayName === name
          );
          if (!celeb) return `${name}: A trading agent.`;
          return `${name} (${celeb.riskLevel}): "${celeb.catchphrase}" — ${celeb.strategyDescription}`;
        })
        .join("\n");

      // Generate conversation via Cerebras
      const comments = await generateConversation(
        agentNames,
        personalitySummaries,
        arena.name,
        standingsContext
      );

      if (comments.length === 0) continue;

      // Insert comments with staggered display_at times (10 seconds apart)
      const batchId = crypto.randomUUID();
      const now = new Date();

      const rows = comments.map((comment, index) => {
        const agentInfo = agentMap.get(comment.agent);
        const displayAt = new Date(now.getTime() + index * 10 * 1000);

        return {
          arena_id: arena.id,
          agent_id: agentInfo?.id || entries[0].agent_id,
          agent_name: comment.agent,
          message: comment.message,
          display_at: displayAt.toISOString(),
          batch_id: batchId,
        };
      });

      const { error: insertError } = await supabase
        .from("arena_comments")
        .insert(rows);

      if (insertError) {
        console.error(
          `Failed to insert comments for arena ${arena.id}:`,
          insertError
        );
      } else {
        totalGenerated += rows.length;
      }
    }

    return NextResponse.json({
      message: `Generated ${totalGenerated} comments`,
      generated: totalGenerated,
    });
  } catch (error) {
    console.error("Generate comments failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function generateConversation(
  agentNames: string[],
  personalitySummaries: string,
  arenaName: string,
  standingsContext: string
): Promise<CommentLine[]> {
  try {
    const prompt = `You are a scriptwriter for "Silicon Coliseum", a trading competition where celebrity AI agents trash-talk each other while competing.

Arena: "${arenaName}"
${standingsContext}

IMPORTANT: The standings above are REAL and ACCURATE. You MUST reference ONLY the correct rankings. The agent in #1 IS winning. The agent in last place IS losing. Do NOT make up or swap positions — use the exact rankings shown above.

The agents in this arena:
${personalitySummaries}

Write a conversation of EXACTLY 90 lines between these agents. Rules:
- Stay 100% in-character for each celebrity personality — Kratos speaks like a war god (short, fierce, prideful), Sherlock is witty and analytical, Tony Stark is arrogant and clever, Michael Scott is clueless but confident, etc.
- Every agent HYPES THEMSELVES as the best while TRASH TALKING others by name
- Agents in top positions should BRAG and FLEX ruthlessly on those below them
- Agents in bottom positions should make EXCUSES, COPE, or fire back with savage roasts
- Agents should ROAST each other directly — call out specific rivals by name, mock their strategies
- Reference actual positions from the standings (e.g. "#1 and you're NOT, cope harder", "Imagine being #15 LOL")
- REFERENCE REAL-LIFE EVENTS, TWEETS, SCANDALS, AND HISTORY of each celebrity to roast them:
  * Elon Musk: buying Twitter, Mars obsession, meme coins, "funding secured", Cybertruck windows
  * Warren Buffett: hating crypto, age, Coca-Cola addiction, missing out on tech
  * Jeff Bezos: bald jokes, space cowboy hat, Amazon warehouse conditions, Blue Origin
  * Mark Zuckerberg: Metaverse flop, "I was human", lizard person memes, MMA phase
  * Bill Gates: divorce, Windows crashes, vaccine conspiracies people make about him
  * Tony Stark: ego, "I am Iron Man", nearly dying constantly, daddy issues
  * Kanye West: Ye era, running for president, fashion disasters, ego
  * The Rock: eyebrow raise, "do you smell what the Rock is cooking", cheat meals
  * Snoop Dogg: 420, cooking show, giving up smoke (then not), the Olympics
  * Michael Scott: "That's what she said", Dunder Mifflin paper sales, clueless management
  * Taylor Swift: ex-boyfriends, Eras tour, beef with Kanye, Scooter Braun masters
  * Kratos: "BOY!", killing gods, anger management, Greek vs Norse
  * Sherlock Holmes: "elementary", violin at 3am, drug habits, condescension
  * Deadpool: breaking 4th wall, chimichangas, Ryan Reynolds confusion, rated R
  * Naruto: "believe it!", ramen addiction, shadow clones, talk-no-jutsu
  * Oprah: "you get a car!", book club, Weight Watchers, billion dollar empire
  * USE THEIR IN-ARENA TRADING ACTIONS TOO — mock bad trades, hype good ones
- Use each character's ICONIC catchphrases and speaking mannerisms
- Keep each message SHORT (1-2 sentences max, like a chaotic group chat)
- Each agent should appear roughly equally (not the same agent 3x in a row)
- USE LOTS OF EMOJIS! Every message needs 1-3 emojis (🔥💀🏆🤡💰📈💪😂🚀👑)
- Mix in slang: "no cap", "fr fr", "cope harder", "rekt", "skill issue", "its giving", "gg ez"
- Make it feel like a SAVAGE, chaotic group chat where everyone thinks they're the best

Format each line EXACTLY as:
AGENT_NAME: message text here

Only use these exact agent names: ${agentNames.join(", ")}

Start now. 90 lines total.`;

    const response = await grok.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8000,
      temperature: 0.9,
    });

    const content = response.choices[0]?.message?.content || "";
    let comments = parseConversation(content, agentNames);

    // If we got fewer than 80, do a second request for more
    if (comments.length < 60) {
      try {
        const moreResponse = await grok.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: `Continue the conversation. Write ${90 - comments.length} more lines of trash-talk between: ${agentNames.join(", ")}. Format: AGENT_NAME: message. Use emojis, keep it short and funny.\n\n${standingsContext}` }],
          max_tokens: 8000,
          temperature: 0.9,
        });
        const moreContent = moreResponse.choices[0]?.message?.content || "";
        const moreComments = parseConversation(moreContent, agentNames);
        comments = [...comments, ...moreComments].slice(0, 90);
      } catch {
        // Use what we have
      }
    }

    return comments.slice(0, 90);
  } catch (error) {
    console.error("Grok conversation generation failed:", error);
    // Retry once
    try {
      const response = await grok.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: `Write 90 lines of funny trash-talk between trading AI agents named: ${agentNames.join(", ")}. Each line should be "AGENT_NAME: short message". Keep it entertaining, in-character, and reference a trading competition called "${arenaName}". USE LOTS OF EMOJIS in every message! Make it feel like a chaotic group chat with roasts and hype.${standingsContext}`,
          },
        ],
        max_tokens: 8000,
        temperature: 0.9,
      });

      const content = response.choices[0]?.message?.content || "";
      return parseConversation(content, agentNames).slice(0, 90);
    } catch (retryError) {
      console.error("Grok retry also failed:", retryError);
      return [];
    }
  }
}

function parseConversation(
  content: string,
  validAgents: string[]
): CommentLine[] {
  const lines = content.split("\n").filter((line) => line.trim());
  const comments: CommentLine[] = [];

  // Build a lookup for agent names (case-insensitive)
  const agentLookup = new Map<string, string>();
  for (const name of validAgents) {
    agentLookup.set(name.toLowerCase(), name);
    // Also handle "The Rock" vs "Rock" etc.
    const words = name.split(" ");
    if (words.length > 1) {
      agentLookup.set(words[words.length - 1].toLowerCase(), name);
    }
  }

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1 || colonIndex > 50) continue;

    const rawName = line.substring(0, colonIndex).trim();
    const message = line.substring(colonIndex + 1).trim();

    if (!message) continue;

    // Try to match agent name
    let agentName = agentLookup.get(rawName.toLowerCase());
    if (!agentName) {
      // Try partial match
      for (const [key, value] of agentLookup.entries()) {
        if (rawName.toLowerCase().includes(key) || key.includes(rawName.toLowerCase())) {
          agentName = value;
          break;
        }
      }
    }

    if (agentName) {
      comments.push({ agent: agentName, message });
    }
  }

  // Ensure we have at most 120 comments
  return comments.slice(0, 90);
}
