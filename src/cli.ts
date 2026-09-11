#!/usr/bin/env bun
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  EMOJI_FILE,
  SHELL_SNIPPET,
  cacheAgeSeconds,
  cachedEmoji,
  configExists,
  loadConfig,
  loadState,
  saveConfig,
  type Config,
  type Feed,
  type Window,
} from "./config.ts";
import { recompute, runCheck } from "./check.ts";
import { WINDOW_LABEL, ago, cadenceDays, describeCadence, fetchFeed, freshItem, shortCadence, type FeedDoc } from "./feed.ts";
import { SOURCE_LINE, ZSHRC, ensureSnippet, otherShellSnippet, patchZshrc, zshrcSourcesSnippet } from "./install.ts";
import { c, pad, trunc } from "./theme.ts";

const HELP = `emoji-rss - your prompt emoji, driven by RSS/Atom feeds

usage: emoji-rss [command]

commands:
  (none)           interactive menu: add, edit, reorder, remove feeds
  add [url]        add a feed and pick its emoji
  ls               list feeds and what the last check found
  rm               remove a feed
  check            fetch every feed now, instead of waiting out the ttl
  now              print the emoji the prompt is currently showing
  install          write the zsh hook and wire it into ~/.zshrc
  help             this text

flags:
  --force          check: ignore the ttl and fetch anyway
  --quiet          check: print nothing (how the shell hook calls it)
  --refresh        now: refresh first instead of reading the cache

how it works:
  feeds live in ${CONFIG_FILE}
  the winning emoji is written to ${EMOJI_FILE}
  your prompt reads that one file and never waits on the network; it spawns a
  detached \`emoji-rss check\` only when the cache goes stale.
  every feed with a fresh item shows its emoji, side by side. feed order is
  priority, which decides who gets cut when more are fresh than maxEmoji allows.
`;

const WINDOWS: Window[] = ["today", "24h", "7d"];

/** Last-resort feed name, for the rare feed with no <title> of its own. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function bail(message: string): never {
  cancel(message);
  process.exit(1);
}

function unwrap<T>(v: T | symbol): T {
  if (isCancel(v)) bail("cancelled - nothing changed.");
  return v as T;
}

const validEmoji = (v: string | undefined) => {
  const s = (v ?? "").trim();
  if (!s) return "give it an emoji";
  if (/\s/.test(s)) return "no spaces";
  if (Bun.stringWidth(s) > 2) return "too wide for a prompt - one emoji, please";
  return undefined;
};

/* ---------------------------------------------------------------- listing */

function feedLine(f: Feed, i: number, state: Awaited<ReturnType<typeof loadState>>, width: number) {
  const s = state?.feeds.find((x) => x.url === f.url);
  const showing = state?.winners.includes(f.name);

  // The name itself carries the common answer: green is showing, grey is not.
  // Only the states you cannot guess from a colour keep a word next to them.
  const name = trunc(f.name, width - 2);
  const [painted, note] = !f.enabled
    ? [c.dim(name), c.dim("off")]
    : s?.error
      ? [c.red(name), c.red("error")]
      : showing
        ? [c.green(name), ""]
        : s?.hit
          ? [c.yellow(name), c.yellow("over the cap")]
          : [c.dim(name), ""];

  // What the feed is actually doing. The freshness window used to sit here as
  // "posted in the last 24h", which read as a report next to "quiet" and said
  // the opposite thing; it is config, and `edit` is where config belongs.
  const facts = [ago(s?.latest), shortCadence(s?.cadenceDays ?? null)].filter(Boolean).join(" · ");

  return `${c.dim(String(i + 1).padStart(2))} ${f.emoji} ${pad(painted, width)}${c.dim(facts || "not checked yet")}${note ? `  ${note}` : ""}`;
}

async function listFeeds(cfg: Config) {
  const state = await loadState();
  if (cfg.feeds.length === 0) {
    log.info(c.dim("no feeds yet - run `emoji-rss add`"));
    return;
  }
  const width = Math.min(26, Math.max(...cfg.feeds.map((f) => f.name.length)) + 2);
  const showing = await cachedEmoji(cfg.fallback);
  const age = await cacheAgeSeconds();
  note(
    cfg.feeds.map((f, i) => feedLine(f, i, state, width)).join("\n"),
    `feeds ${c.dim("(order is priority)")}`,
  );
  const errored = cfg.feeds.filter((f) => state?.feeds.find((x) => x.url === f.url)?.error);
  for (const f of errored) {
    log.warn(c.yellow(`${f.name}: ${state?.feeds.find((x) => x.url === f.url)?.error}`));
  }
  const when = Number.isFinite(age) ? `checked ${Math.round(age / 60)}m ago` : "never checked";
  const who = state?.winners.length ? state.winners.join(" + ") : "fallback";
  log.info(`showing ${showing}  ${c.dim(`${who} - ${when}`)}`);
}

/* -------------------------------------------------------------- add a feed */

/**
 * Path prefixes worth offering as a filter, e.g. /comic/ next to a feed's news
 * posts. Prefixes that appear once are the feed's own item slugs (xkcd gives
 * every comic its own), so they are noise; if what is left covers every item
 * there is nothing to filter and the question should not be asked at all.
 */
function linkFilterChoices(doc: FeedDoc): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of doc.items) {
    try {
      const seg = new URL(item.link).pathname.split("/").filter(Boolean)[0];
      if (seg) counts.set(`/${seg}/`, (counts.get(`/${seg}/`) ?? 0) + 1);
    } catch {}
  }
  const groups = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  const covered = groups.reduce((n, g) => n + g.count, 0);
  return covered === doc.items.length ? [] : groups;
}

async function addFeed(cfg: Config, preset?: string): Promise<Config> {
  const url = preset ?? unwrap(
    await text({
      message: "feed url",
      placeholder: "https://example.com/feed/",
      validate: (v) => (/^https?:\/\//.test((v ?? "").trim()) ? undefined : "needs to start with http"),
    }),
  );

  const s = spinner();
  s.start(`fetching ${url}`);
  let doc: FeedDoc;
  try {
    doc = await fetchFeed(url.trim());
  } catch (err) {
    s.stop(c.red(`could not read that feed: ${err instanceof Error ? err.message : String(err)}`));
    return cfg;
  }
  if (doc.items.length === 0) {
    s.stop(c.red("no items in that feed - is it really RSS or Atom?"));
    return cfg;
  }
  // The feed says what it is called, so don't make the user retype it. Renaming
  // lives in `edit` for the rare feed whose own title is useless.
  const name = (doc.title || hostOf(url)).trim();
  const cadence = cadenceDays(doc);
  const newest = doc.items.find((i) => i.date)?.date;
  s.stop(
    `${c.bold(name)} ${c.dim(
      [
        `${doc.items.length} items`,
        newest ? `newest ${newest.toLocaleDateString()}` : "",
        describeCadence(cadence),
      ]
        .filter(Boolean)
        .join(", "),
    )}`,
  );

  const emoji = unwrap(
    await text({ message: `emoji for ${name}`, validate: validEmoji }),
  ).trim();

  // A window as long as the feed's own cadence means the emoji is always on,
  // which says nothing. Weekly and faster get "today"; rarer feeds would be too
  // easy to miss that way, so they get the week after a drop.
  const suggested: Window = cadence === null || cadence < 10 ? "today" : "7d";
  const window = unwrap(
    await select<Window>({
      message: "how fresh does an item have to be?",
      options: WINDOWS.map((w) => ({
        value: w,
        label: WINDOW_LABEL[w],
        hint: w === suggested && cadence !== null ? `it ${describeCadence(cadence)}` : undefined,
      })),
      initialValue: suggested,
    }),
  );

  // A filter matters for feeds that mix content (comic pages vs news posts).
  let linkContains: string | undefined;
  const choices = linkFilterChoices(doc);
  if (choices.length > 0) {
    const picked = unwrap(
      await select<string>({
        message: "which items count?",
        options: [
          { value: "", label: "all of them" },
          ...choices.map((ch) => ({
            value: ch.value,
            label: `links under ${ch.value}`,
            hint: `${ch.count} of ${doc.items.length}`,
          })),
          { value: "\0custom", label: "something else in the link…" },
        ],
        initialValue: "",
      }),
    );
    linkContains =
      picked === "\0custom"
        ? unwrap(await text({ message: "link must contain", placeholder: "/comic/" })).trim()
        : picked || undefined;
  }

  const feed: Feed = { name, url: url.trim(), emoji, linkContains, window, enabled: true };

  const hit = freshItem(doc, feed);
  if (hit) {
    const alongside = (await loadState())?.winners.length ?? 0;
    log.info(
      `${emoji} would be showing right now ${c.dim(`- ${hit.title || hit.link}${alongside ? `, alongside ${alongside} other${alongside === 1 ? "" : "s"}` : ""}`)}`,
    );
  } else {
    log.info(c.dim(`nothing ${WINDOW_LABEL[window]} right now, so ${emoji} would stay hidden`));
  }

  let next = { ...cfg, feeds: [...cfg.feeds, feed] };
  await saveConfig(next);
  // The fetch above already answered "is it fresh", so the prompt can pick this
  // feed up now instead of waiting out the ttl. No second request.
  const state = await recompute(next, {
    url: feed.url,
    hit: Boolean(hit),
    item: hit?.link,
    checkedAt: Date.now(),
  });
  log.success(
    `added ${name} - your prompt now shows ${state.emoji} ${c.dim("(edit renames it)")}`,
  );

  // A feed nothing reads is not actually added, so check the wiring here rather
  // than leaving it as a separate step the user has to know about.
  next = await ensureWired(next);
  return next;
}

/* ------------------------------------------------------------ edit / remove */

async function pickFeed(cfg: Config, message: string): Promise<number | null> {
  if (cfg.feeds.length === 0) {
    log.info(c.dim("no feeds yet"));
    return null;
  }
  const i = unwrap(
    await select<number>({
      message,
      options: cfg.feeds.map((f, idx) => ({
        value: idx,
        label: `${f.emoji} ${f.name}${f.enabled ? "" : c.dim(" (off)")}`,
        hint: f.url,
      })),
    }),
  );
  return i;
}

async function editFeed(cfg: Config): Promise<Config> {
  const i = await pickFeed(cfg, "edit which feed?");
  if (i === null) return cfg;
  const f = cfg.feeds[i]!;

  const field = unwrap(
    await select<string>({
      message: `${f.emoji} ${f.name}`,
      options: [
        { value: "emoji", label: "change the emoji", hint: f.emoji },
        { value: "name", label: "rename", hint: f.name },
        { value: "window", label: "change freshness window", hint: WINDOW_LABEL[f.window] },
        { value: "filter", label: "change the link filter", hint: f.linkContains ?? "none" },
        { value: "toggle", label: f.enabled ? "disable it" : "enable it" },
        { value: "top", label: "give it top priority" },
      ],
    }),
  );

  const feeds = [...cfg.feeds];
  switch (field) {
    case "emoji":
      feeds[i] = { ...f, emoji: unwrap(await text({ message: "emoji", initialValue: f.emoji, validate: validEmoji })).trim() };
      break;
    case "name":
      feeds[i] = { ...f, name: unwrap(await text({ message: "name", initialValue: f.name })).trim() || f.name };
      break;
    case "window":
      feeds[i] = {
        ...f,
        window: unwrap(
          await select<Window>({
            message: "how fresh?",
            options: WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] })),
            initialValue: f.window,
          }),
        ),
      };
      break;
    case "filter": {
      const v = unwrap(
        await text({ message: "link must contain (empty for no filter)", initialValue: f.linkContains ?? "" }),
      ).trim();
      feeds[i] = { ...f, linkContains: v || undefined };
      break;
    }
    case "toggle":
      feeds[i] = { ...f, enabled: !f.enabled };
      break;
    case "top":
      feeds.splice(i, 1);
      feeds.unshift(f);
      break;
  }

  const next = { ...cfg, feeds };
  await saveConfig(next);
  await recompute(next);
  log.success("saved");
  return next;
}

async function removeFeed(cfg: Config): Promise<Config> {
  const i = await pickFeed(cfg, "remove which feed?");
  if (i === null) return cfg;
  const f = cfg.feeds[i]!;
  const ok = unwrap(await confirm({ message: `remove ${f.emoji} ${f.name}?`, initialValue: false }));
  if (!ok) {
    log.info(c.dim("kept it"));
    return cfg;
  }
  const next = { ...cfg, feeds: cfg.feeds.filter((_, idx) => idx !== i) };
  await saveConfig(next);
  await recompute(next);
  log.success(`removed ${f.name}`);
  return next;
}

async function setFallback(cfg: Config): Promise<Config> {
  const v = unwrap(
    await text({ message: "emoji when nothing is fresh", initialValue: cfg.fallback, validate: validEmoji }),
  ).trim();
  const next = { ...cfg, fallback: v };
  await saveConfig(next);
  await recompute(next);
  log.success(`fallback is ${v}`);
  return next;
}

/* ---------------------------------------------------------------- commands */

async function setMaxEmoji(cfg: Config): Promise<Config> {
  const v = unwrap(
    await select<number>({
      message: "most emoji to show at once",
      options: [1, 2, 3, 4, 5].map((n) => ({
        value: n,
        label: n === 1 ? "1 - only the top priority feed" : `${n}`,
      })),
      initialValue: cfg.maxEmoji,
    }),
  );
  const next = { ...cfg, maxEmoji: v };
  await saveConfig(next);
  await recompute(next);
  log.success(`up to ${v} at once`);
  return next;
}

async function checkNow(cfg: Config, quiet: boolean) {
  if (quiet) {
    await runCheck(cfg);
    return;
  }
  const s = spinner();
  const n = cfg.feeds.filter((f) => f.enabled).length;
  s.start(`checking ${n} feed${n === 1 ? "" : "s"}`);
  const result = await runCheck(cfg);
  if (result.skipped) {
    s.stop(c.dim("another check is already running"));
    return;
  }
  s.stop(`${result.emoji}  ${result.winners.join(" + ") || c.dim("nothing fresh - fallback")}`);
  for (const f of result.feeds) {
    if (f.error) log.warn(c.yellow(`${f.url}: ${f.error}`));
  }
}

/**
 * Keep the shell wiring true without making it a separate chore: refresh the
 * hook file silently, and only speak up if the prompt is not reading it yet.
 * Returns the config because saying no is remembered.
 */
async function ensureWired(cfg: Config, verbose = false): Promise<Config> {
  const snippet = await ensureSnippet();
  if (verbose && snippet === "current") log.info(c.dim(`hook is current: ${SHELL_SNIPPET}`));
  if (verbose && snippet === "written") log.success(`wrote ${SHELL_SNIPPET}`);

  if (await zshrcSourcesSnippet()) {
    if (verbose) log.info(c.dim("~/.zshrc already sources it"));
    return cfg;
  }

  if (cfg.skipShellPrompt && !verbose) return cfg;

  log.warn(c.yellow("your prompt is not reading this yet"));
  const ok = unwrap(
    await confirm({ message: `add one line to ${ZSHRC} so it does?`, initialValue: true }),
  );
  if (ok) {
    await patchZshrc();
    log.success("wired up - open a new tab, or run: source ~/.zshrc");
    if (cfg.skipShellPrompt) {
      const next = { ...cfg, skipShellPrompt: undefined };
      await saveConfig(next);
      return next;
    }
    return cfg;
  }

  note(SOURCE_LINE, "add this to ~/.zshrc yourself");
  if (!cfg.skipShellPrompt) {
    const next = { ...cfg, skipShellPrompt: true };
    await saveConfig(next);
    log.info(c.dim("won't ask again - `emoji-rss install` when you want it"));
    return next;
  }
  return cfg;
}

async function doInstall(cfg: Config): Promise<Config> {
  const next = await ensureWired(cfg, true);
  note(otherShellSnippet(EMOJI_FILE), "for any other prompt or statusline (bash/sh)");
  return next;
}

/* -------------------------------------------------------------------- menu */

async function menu(cfg: Config) {
  let current = cfg;
  for (;;) {
    await listFeeds(current);
    const action = unwrap(
      await select<string>({
        message: "what now?",
        options: [
          { value: "add", label: "add a feed" },
          { value: "edit", label: "edit a feed", hint: "emoji, name, window, priority" },
          { value: "rm", label: "remove a feed" },
          { value: "fallback", label: "change the fallback emoji", hint: current.fallback },
          { value: "max", label: "how many emoji can show at once", hint: String(current.maxEmoji) },
          { value: "check", label: "check every feed now" },
          { value: "quit", label: "done" },
        ],
      }),
    );
    switch (action) {
      case "add":
        current = await addFeed(current);
        break;
      case "edit":
        current = await editFeed(current);
        break;
      case "rm":
        current = await removeFeed(current);
        break;
      case "fallback":
        current = await setFallback(current);
        break;
      case "max":
        current = await setMaxEmoji(current);
        break;
      case "check":
        await checkNow(current, false);
        break;
      case "quit":
        outro(`${await cachedEmoji(current.fallback)} ${c.dim(CONFIG_FILE)}`);
        return;
    }
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const args = argv.filter((a) => !a.startsWith("-"));
  const cmd = args[0] ?? "";

  if (flags.has("-h") || flags.has("--help") || cmd === "help") {
    process.stdout.write(HELP);
    return;
  }

  const cfg = await loadConfig();

  // `now` is the one command a prompt might call directly: cache only, no UI.
  if (cmd === "now") {
    if (flags.has("--refresh")) await runCheck(cfg);
    process.stdout.write(await cachedEmoji(cfg.fallback));
    return;
  }

  if (cmd === "check") {
    const quiet = flags.has("--quiet");
    // The shell hook may be the very first thing to run: seed the config so the
    // defaults are editable instead of invisible.
    if (!(await configExists())) await saveConfig(cfg);
    if (!flags.has("--force")) {
      const age = await cacheAgeSeconds();
      if (age < cfg.ttlSeconds) {
        if (!quiet) log.info(c.dim(`cache is ${Math.round(age / 60)}m old - use --force to fetch anyway`));
        return;
      }
    }
    if (!quiet) intro(c.title(" emoji-rss "));
    await checkNow(cfg, quiet);
    return;
  }

  intro(c.title(" emoji-rss "));

  let config = cfg;

  // First run: the defaults are seeded but nothing is on disk yet.
  if (!(await configExists())) {
    await saveConfig(config);
    log.info(
      `started you off with ${DEFAULT_CONFIG.feeds.map((f) => `${f.emoji} ${f.name}`).join(", ")} and a ${config.fallback} fallback`,
    );
    config = await ensureWired(config);
  }

  switch (cmd) {
    case "":
      await menu(config);
      return;
    case "add":
      await addFeed(config, args[1]);
      break;
    case "ls":
    case "list":
      await listFeeds(config);
      break;
    case "rm":
    case "remove":
      await removeFeed(config);
      break;
    case "edit":
      await editFeed(config);
      break;
    case "install":
      await doInstall(config);
      break;
    default:
      throw new Error(`unknown command: ${cmd}\n\n${HELP}`);
  }
  outro(c.dim(CONFIG_FILE));
}

main().catch((err) => {
  cancel(c.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
