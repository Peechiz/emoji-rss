/** Config + cache locations, schema, and atomic read/write. */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, renameSync } from "node:fs";

export type Window = "today" | "24h" | "7d";

export type Feed = {
  name: string;
  url: string;
  emoji: string;
  /** Only count items whose link contains this substring (e.g. "/comic/"). */
  linkContains?: string;
  /** How recent an item has to be to count. */
  window: Window;
  enabled: boolean;
};

export type Config = {
  version: 1;
  /** Shown when no feed has a fresh item. */
  fallback: string;
  /** How long a cached result stays good before a prompt triggers a refresh. */
  ttlSeconds: number;
  /** Cap on emoji shown at once, so a busy day can't run away with the prompt. */
  maxEmoji: number;
  /** Order is priority: when more feeds are fresh than fit, the top ones show. */
  feeds: Feed[];
  /** Set once the user says no to wiring up the shell, so it stops asking. */
  skipShellPrompt?: boolean;
};

/** Per-feed result of the last check, kept so a failed fetch never clears a hit. */
export type FeedState = {
  url: string;
  hit: boolean;
  /** Link of the item that matched, for `ls` output. */
  item?: string;
  /** Date of the newest item, ignoring the window: "when did this last post". */
  latest?: string;
  /**
   * Median days between posts, measured from the feed's own items. Feeds do
   * declare a frequency, but it is near-useless -- WordPress emits "hourly" for
   * a weekly comic, and plenty of feeds declare nothing at all.
   */
  cadenceDays?: number | null;
  checkedAt: number;
  error?: string;
};

export type State = {
  checkedAt: number;
  /** Every showing emoji, concatenated. The fallback when nothing is fresh. */
  emoji: string;
  /** Names of the feeds showing, in priority order; empty for the fallback. */
  winners: string[];
  feeds: FeedState[];
};

const home = homedir();
export const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "emoji-rss");
export const CACHE_DIR = join(process.env.XDG_CACHE_HOME || join(home, ".cache"), "emoji-rss");
export const CONFIG_FILE = join(CONFIG_DIR, "feeds.json");
/** The one file prompts read. Contains the emoji and nothing else, no newline. */
export const EMOJI_FILE = join(CACHE_DIR, "emoji");
export const STATE_FILE = join(CACHE_DIR, "state.json");
export const LOCK_DIR = join(CACHE_DIR, "refresh.lock");
export const SHELL_SNIPPET = join(CONFIG_DIR, "emoji-rss.zsh");

export const DEFAULT_FALLBACK = "🔥";

/** First run seeds the setup this replaces, so the prompt looks the same. */
export const DEFAULT_CONFIG: Config = {
  version: 1,
  fallback: DEFAULT_FALLBACK,
  ttlSeconds: 1800,
  maxEmoji: 3,
  feeds: [
    {
      name: "Kill Six Billion Demons",
      url: "https://killsixbilliondemons.com/feed/",
      emoji: "😈",
      linkContains: "/comic/",
      window: "today",
      enabled: true,
    },
  ],
};

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_FILE);
  if (!(await file.exists())) return structuredClone(DEFAULT_CONFIG);
  const raw = (await file.json()) as Partial<Config>;
  return {
    version: 1,
    fallback: raw.fallback || DEFAULT_FALLBACK,
    ttlSeconds: typeof raw.ttlSeconds === "number" ? raw.ttlSeconds : 1800,
    maxEmoji: typeof raw.maxEmoji === "number" && raw.maxEmoji > 0 ? raw.maxEmoji : 3,
    skipShellPrompt: raw.skipShellPrompt === true ? true : undefined,
    feeds: (raw.feeds ?? []).map((f) => ({
      name: f.name ?? f.url,
      url: f.url,
      emoji: f.emoji,
      linkContains: f.linkContains || undefined,
      window: f.window ?? "today",
      enabled: f.enabled !== false,
    })),
  };
}

export async function configExists(): Promise<boolean> {
  return Bun.file(CONFIG_FILE).exists();
}

/** Write via temp file + rename so a prompt never reads a half-written file. */
async function writeAtomic(path: string, contents: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, contents);
  renameSync(tmp, path);
}

export async function saveConfig(cfg: Config): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await writeAtomic(CONFIG_FILE, `${JSON.stringify(cfg, null, 2)}\n`);
}

export async function loadState(): Promise<State | null> {
  const file = Bun.file(STATE_FILE);
  if (!(await file.exists())) return null;
  try {
    const raw = (await file.json()) as State & { winner?: string };
    // State written before multiple emoji could show at once.
    if (!raw.winners) raw.winners = raw.winner ? [raw.winner] : [];
    return raw;
  } catch {
    return null;
  }
}

export async function saveState(state: State): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  await writeAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  await writeAtomic(EMOJI_FILE, state.emoji);
}

/** Emoji the prompts are currently showing, without touching the network. */
export async function cachedEmoji(fallback: string): Promise<string> {
  const file = Bun.file(EMOJI_FILE);
  if (!(await file.exists())) return fallback;
  const text = (await file.text()).trim();
  return text || fallback;
}

/** Age of the cache in seconds; Infinity when it has never been written. */
export async function cacheAgeSeconds(): Promise<number> {
  const file = Bun.file(EMOJI_FILE);
  if (!(await file.exists())) return Infinity;
  const { mtimeMs } = await file.stat();
  return (Date.now() - mtimeMs) / 1000;
}
