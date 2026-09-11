# emoji-rss

The emoji at the front of your prompt, driven by RSS/Atom feeds. Your comic
posted today → 😈. That and a rocket launch → 😈🚀. Neither → 🔥. You pick the
feeds and the emoji; it starts empty.

Works in the zsh prompt and in the Claude Code statusline at the same time, off
one shared cache file.

```
😈🚀 emoji-rss [main ●] | Opus 5 | 91%
```

## Install

```sh
bun install
bun link               # puts emoji-rss on your PATH (~/.bun/bin)
emoji-rss add <url>    # it offers to wire up your shell on the way
```

`bun link` registers this directory and symlinks the `emoji-rss` bin, so edits
to `src/` are live and there is nothing to rebuild. `bun unlink` undoes it. For
a standalone binary with nothing pointing back here, `bun run build` produces
`./emoji-rss` and you can symlink that onto your PATH instead.

There is no separate setup step. Any interactive run refreshes the zsh hook at
`~/.config/emoji-rss/emoji-rss.zsh`, and if your prompt is not reading it yet,
adding a feed offers to append the one `source` line to `~/.zshrc`. Say no and
it stops asking. Nothing is configured for you: until you add a feed the prompt
shows the fallback 🔥.

`emoji-rss install` does the same wiring on demand, and prints a plain sh
snippet for any prompt it will not edit (a bash statusline, tmux, whatever).

## Use

```sh
emoji-rss                 # menu: add / edit / remove, with config one level down
emoji-rss add <url>       # fetch the feed, name it, pick an emoji
emoji-rss ls              # feeds in priority order, when each last posted
emoji-rss check           # fetch every feed, print what each one did
emoji-rss go              # open the new item in your browser
emoji-rss now             # print the emoji the prompt is showing (no network)
```

Adding a feed fetches it first and uses what it finds, so it only asks you
things the feed can't answer. It takes the name from the feed's own title,
reports how often it posts, and preselects a freshness window that matches that
cadence. `edit → rename` is there for the rare feed whose own title is useless.

It always asks which items count, and it asks with a list, because nobody
should have to guess at a substring. The choices are read out of the feed's own
links, each with the number of items it keeps:

```
which items count?
● all of them                       96 items
○ links starting with "solari"      11 of 96
○ links starting with "fireside"     4 of 96
○ something else in the link…
```

Two shapes cover nearly every feed. Some name the section in the path, so KSBD
offers `links under /comic/` (7 of 10) and leaves out its "next update Thursday"
posts. Some file everything under one path — all 96 Worlds Beyond Number items
live under `/episodes/` — and the only thing separating a story episode from a
fireside chat is the start of the slug, so that is what it offers instead.
"All of them" is the default, so a feed that doesn't need narrowing is one
Enter. Free text is still there at the bottom, and it won't take a substring
that matches nothing. `edit → change the link filter` shows the same list,
with whatever the feed uses now already selected.

Every interactive run fetches all your feeds before it shows you anything, so
`ls` and the menu are never reporting yesterday. `check` is that fetch on its
own, and it is what the shell hook runs in the background; typed by hand it
always fetches, and `--quiet` is the mode that honours the ttl instead.

A searchable emoji picker is deliberately not built; `docs/emoji-picker.md` has
the notes if free text ever gets annoying.

`go` is the other half of the emoji: it says something happened, `go` opens it.
It only appears in the menu when a feed is actually fresh -- with nothing new
there is nothing to open. `go <feed>` opens a named feed's latest whatever its
age, since you asked for it by name.

`ls` colours each feed by what it is doing — green is showing in your prompt,
grey is not — and shows when it last posted next to how often it posts, both
measured from the feed's own items. Feeds do declare an update frequency, but it
is not worth reading: WordPress emits "hourly" for a weekly comic, and plenty of
feeds declare nothing at all.

```
 1 😈 Kill Six Billion Demons  3h ago · ~weekly
 2 🐉 Worlds Beyond Number     11d ago · ~biweekly
```

## How it doesn't slow down your prompt

The prompt never touches the network and never forks.

- `emoji-rss check` fetches every feed, picks the winners, and writes them to
  `~/.cache/emoji-rss/emoji` — that file holds one emoji and nothing else. Its
  mtime is the time of the last *network* check, not of the last write, so
  editing an emoji can't buy the prompt a quiet half hour.
- The zsh hook reads that file with `$(<file)`, a zsh builtin, and gets the
  mtime with `zstat` from `zsh/stat`. No subprocesses in `precmd`.
- Only when the cache is older than the TTL (30 min) does it spawn a detached
  `check` and move on. The cache gets rewritten even when every fetch fails, so
  a dead network backs off to one attempt per TTL instead of one per prompt.
- A failed fetch keeps that feed's last known answer rather than caching it as
  "nothing new" — otherwise the emoji would blink off on every network hiccup.

## Config

`~/.config/emoji-rss/feeds.json`:

```json
{
  "version": 1,
  "fallback": "🔥",
  "ttlSeconds": 1800,
  "maxEmoji": 3,
  "feeds": [
    {
      "name": "Kill Six Billion Demons",
      "url": "https://killsixbilliondemons.com/feed/",
      "emoji": "😈",
      "linkContains": "/comic/",
      "window": "today",
      "enabled": true
    }
  ]
}
```

- **Every fresh feed shows**, concatenated in config order: three feeds updated
  today gives you `😈🚀🍊`.
- **`maxEmoji`** ("character limit" in the menu) caps that at 3, so a busy day
  can't run away with your prompt.
  When more feeds are fresh than fit, order decides who gets cut — `config →
  reorder feeds` moves one, and `ls` marks the rest "over the cap".
- **`window`** is `today` (local calendar day), `24h`, or `7d`. A window as long
  as the feed's own posting cadence leaves the emoji permanently on, which says
  nothing, so `add` suggests `today` for anything weekly or faster and `7d` for
  rarer feeds.
- **`linkContains`** filters by item link, and both `add` and `edit` offer it as
  a list of the feed's own groupings. It is a plain substring, not a path:
  `/comic/` counts only KSBD's comics, and `/solari-` counts one podcast series
  out of the 96 episodes sharing its `/episodes/` path.

## Shell knobs

Set these before the `source` line in `~/.zshrc`:

| variable | default | |
|---|---|---|
| `EMOJI_RSS_FALLBACK` | `🔥` | emoji when nothing is fresh |
| `EMOJI_RSS_TTL` | `1800` | seconds before the cache is stale |
| `EMOJI_RSS_BIN` | `emoji-rss` | the CLI to run |
| `EMOJI_RSS_NO_PROMPT` | unset | keep your own `PROMPT`, just get `$EMOJI_RSS_EMOJI` |

The hook ships a `PROMPT` that mirrors oh-my-zsh's `kolo` theme with its
hardcoded 🔥 swapped for `${EMOJI_RSS_EMOJI}`. On a different theme, set
`EMOJI_RSS_NO_PROMPT=1` and put `${EMOJI_RSS_EMOJI}` in your own prompt — it is
plain text, re-expanded every render by `prompt_subst`.

`emoji-rss-refresh` forces a fetch and redraws the prompt.

## Layout

| | |
|---|---|
| `src/config.ts` | paths, schema, atomic reads/writes |
| `src/feed.ts` | RSS/Atom parsing, freshness windows |
| `src/check.ts` | the refresh: lock, fetch, pick a winner, write the cache |
| `src/cli.ts` | clack UI and subcommands |
| `src/install.ts` | shell wiring |
| `shell/emoji-rss.zsh` | the zsh hook (embedded in the compiled binary) |
