/**
 * Minimal RSS 2.0 / Atom reader.
 *
 * Regex, not a parser: feeds are the one XML dialect where the shape is boring
 * enough for it, and this runs on every stale prompt render, so it stays cheap
 * and dependency-free.
 */
import type { Feed, Window } from "./config.ts";

export type Item = {
  title: string;
  link: string;
  date: Date | null;
};

export type FeedDoc = {
  title: string;
  items: Item[];
};

const FETCH_TIMEOUT_MS = 8000;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

function tag(chunk: string, name: string): string {
  const m = chunk.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1] ?? "") : "";
}

/** RSS puts the URL in the element body; Atom puts it in a href attribute. */
function itemLink(chunk: string): string {
  const rss = chunk.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
  if (rss && rss[1] && rss[1].trim()) return decode(rss[1]);
  // Prefer rel="alternate" (the human page) over rel="replies", "edit", etc.
  const links = [...chunk.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1] ?? "");
  const pick =
    links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ??
    links.find((a) => !/rel\s*=\s*["']/i.test(a)) ??
    links[0];
  const href = pick?.match(/href\s*=\s*["']([^"']+)["']/i);
  return href ? decode(href[1] ?? "") : "";
}

function itemDate(chunk: string): Date | null {
  for (const name of ["pubDate", "published", "updated", "dc:date", "date"]) {
    const raw = tag(chunk, name);
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseFeed(xml: string): FeedDoc {
  const chunks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  // The channel title is whatever <title> comes before the first item.
  const head = chunks.length ? xml.slice(0, xml.indexOf(chunks[0] ?? "")) : xml;
  return {
    title: tag(head, "title"),
    items: chunks.map((chunk) => ({
      title: tag(chunk, "title"),
      link: itemLink(chunk),
      date: itemDate(chunk),
    })),
  };
}

export async function fetchFeed(url: string): Promise<FeedDoc> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { "user-agent": "emoji-rss", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}

/** Start of the period an item has to fall inside to count as fresh. */
export function windowStart(w: Window, now = new Date()): Date {
  switch (w) {
    case "today": {
      // Local calendar day, not the last 24 hours: "did it update today?"
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "24h":
      return new Date(now.getTime() - 24 * 3600 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  }
}

export const WINDOW_LABEL: Record<Window, string> = {
  today: "posted today",
  "24h": "posted in the last 24h",
  "7d": "posted in the last 7 days",
};

/** The newest item matching the link filter, whatever its age. */
export function latestItem(doc: FeedDoc, feed: Feed): Item | null {
  const match = feed.linkContains?.trim();
  let best: Item | null = null;
  for (const item of doc.items) {
    if (match && !item.link.includes(match)) continue;
    if (!item.date) continue;
    if (!best || item.date > best.date!) best = item;
  }
  return best;
}

/** The newest item matching the feed's link filter and freshness window. */
export function freshItem(doc: FeedDoc, feed: Feed, now = new Date()): Item | null {
  const since = windowStart(feed.window, now);
  const match = feed.linkContains?.trim();
  for (const item of doc.items) {
    if (match && !item.link.includes(match)) continue;
    if (!item.date) continue;
    if (item.date >= since) return item;
  }
  return null;
}

/**
 * Median days between recent items. Used to pick a sensible freshness window:
 * a daily comic and a fortnightly podcast want very different answers, and the
 * feed already says which it is.
 */
export function cadenceDays(doc: FeedDoc): number | null {
  const dates = doc.items
    .map((i) => i.date)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())
    .slice(0, 12);
  if (dates.length < 3) return null;
  const gaps = dates
    .slice(1)
    .map((d, i) => (dates[i]!.getTime() - d.getTime()) / 86400000)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? null;
}

export function describeCadence(days: number | null): string {
  if (days === null) return "";
  if (days < 1.5) return "posts about daily";
  if (days < 3) return "posts every couple of days";
  if (days < 10) return "posts about weekly";
  if (days < 20) return "posts about every two weeks";
  return "posts about monthly";
}

/** The same thing, short enough for a column: "~weekly". */
export function shortCadence(days: number | null): string {
  if (days === null) return "";
  if (days < 1.5) return "~daily";
  if (days < 3) return "~every 2d";
  if (days < 10) return "~weekly";
  if (days < 20) return "~biweekly";
  return "~monthly";
}

/** Compact age for a column: "3h ago", "12d ago". */
export function ago(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
