/**
 * The refresh: fetch every enabled feed, pick a winner, write the cache.
 *
 * Prompts never call into this synchronously -- they read the cache file and
 * spawn this detached when it goes stale -- so it is allowed to be slow, but it
 * must never leave the cache in a worse state than it found it.
 */
import { mkdirSync, rmdirSync } from "node:fs";
import {
  CACHE_DIR,
  LOCK_DIR,
  loadState,
  saveState,
  type Config,
  type Feed,
  type FeedState,
  type State,
} from "./config.ts";
import { fetchFeed, freshItem } from "./feed.ts";

/** Single-flight: mkdir is atomic, so the loser just bails. */
function acquireLock(): boolean {
  mkdirSync(CACHE_DIR, { recursive: true });
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    rmdirSync(LOCK_DIR);
  } catch {}
}

async function checkFeed(feed: Feed, previous?: FeedState): Promise<FeedState> {
  const now = Date.now();
  try {
    const doc = await fetchFeed(feed.url);
    const item = freshItem(doc, feed);
    return { url: feed.url, hit: Boolean(item), item: item?.link, checkedAt: now };
  } catch (err) {
    // A failed fetch keeps the last known answer. Caching it as "no update"
    // would blink the emoji off every time the network hiccups.
    return {
      url: feed.url,
      hit: previous?.hit ?? false,
      item: previous?.item,
      checkedAt: previous?.checkedAt ?? 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CheckResult = State & { skipped: boolean };

/** Config order is priority; it only bites once more feeds are fresh than fit. */
function buildState(cfg: Config, results: FeedState[]): State {
  const hitByUrl = new Map(results.map((r) => [r.url, r.hit]));
  const winners = cfg.feeds
    .filter((f) => f.enabled && hitByUrl.get(f.url))
    .slice(0, cfg.maxEmoji);
  return {
    checkedAt: Date.now(),
    emoji: winners.length ? winners.map((f) => f.emoji).join("") : cfg.fallback,
    winners: winners.map((f) => f.name),
    feeds: results,
  };
}

/**
 * Rewrite the cache from results already on disk, without touching the network.
 *
 * Editing an emoji, reordering, removing a feed or changing the cap all change
 * what should be showing but nothing about what is fresh, so the prompt can
 * catch up immediately instead of waiting out the ttl.
 */
export async function recompute(cfg: Config, seed?: FeedState): Promise<State> {
  const previous = await loadState();
  const byUrl = new Map((previous?.feeds ?? []).map((f) => [f.url, f]));
  if (seed) byUrl.set(seed.url, seed);
  // Drop results for feeds that are gone, keep the order config expects.
  const results = cfg.feeds.map((f) => byUrl.get(f.url)).filter((r): r is FeedState => Boolean(r));
  const state = buildState(cfg, results);
  // Keep the age of the real network check: a recompute must not reset the ttl.
  state.checkedAt = previous?.checkedAt ?? 0;
  await saveState(state);
  return state;
}

export async function runCheck(cfg: Config): Promise<CheckResult> {
  const previous = await loadState();
  const prevByUrl = new Map((previous?.feeds ?? []).map((f) => [f.url, f]));

  if (!acquireLock()) {
    // Another refresh is already running; report what is on disk now.
    return {
      checkedAt: previous?.checkedAt ?? 0,
      emoji: previous?.emoji ?? cfg.fallback,
      winners: previous?.winners ?? [],
      feeds: previous?.feeds ?? [],
      skipped: true,
    };
  }

  try {
    const enabled = cfg.feeds.filter((f) => f.enabled);
    const results = await Promise.all(enabled.map((f) => checkFeed(f, prevByUrl.get(f.url))));
    const state = buildState(cfg, results);
    await saveState(state);
    return { ...state, skipped: false };
  } finally {
    releaseLock();
  }
}

/** Fire-and-forget refresh, detached so the caller can exit immediately. */
export function spawnDetachedCheck() {
  // Compiled binary: argv[0] is the binary and the entry is baked in.
  // Source run: argv[0] is bun and the script has to be passed along.
  const compiled = !Bun.main.endsWith(".ts");
  const cmd = compiled
    ? [process.execPath, "check", "--quiet"]
    : [process.execPath, Bun.main, "check", "--quiet"];
  Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).unref();
}
