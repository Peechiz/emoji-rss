# emoji-rss

The emoji at the front of your prompt, driven by RSS/Atom feeds. Kill Six Billion
Demons posted today → 😈. That and a rocket launch → 😈🚀. Neither → 🔥. Add your
own feed/emoji pairs with a CLI.

Works in the zsh prompt and in the Claude Code statusline at the same time, off
one shared cache file.

```
😈🚀 emoji-rss [main ●] | Opus 5 | 91%
```

## Install

```sh
bun install
bun run build          # produces ./emoji-rss
ln -s "$PWD/emoji-rss" ~/.local/bin/emoji-rss
emoji-rss add <url>    # it offers to wire up your shell on the way
```

There is no separate setup step. Any interactive run refreshes the zsh hook at
`~/.config/emoji-rss/emoji-rss.zsh`, and if your prompt is not reading it yet,
adding a feed offers to append the one `source` line to `~/.zshrc`. Say no and
it stops asking.

`emoji-rss install` does the same wiring on demand, and prints a plain sh
snippet for any prompt it will not edit (a bash statusline, tmux, whatever).

## Use

```sh
emoji-rss                 # menu: add / edit / reorder / remove / check
emoji-rss add <url>       # fetch the feed, name it, pick an emoji
emoji-rss ls              # feeds, priority order, what the last check found
emoji-rss check --force   # fetch now
emoji-rss now             # print the emoji the prompt is showing (no network)
```

Adding a feed fetches it first, so the prompts are answerable: it shows you the
item count, the newest item's date, which path prefixes the links use, and
whether your new emoji would be showing right now.

## How it doesn't slow down your prompt

The prompt never touches the network and never forks.

- `emoji-rss check` fetches every feed, picks a winner, and writes it to
  `~/.cache/emoji-rss/emoji` — that file holds one emoji and nothing else.
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
- **`maxEmoji`** caps that at 3 so a busy day can't run away with your prompt.
  When more feeds are fresh than fit, order decides who gets cut — `edit → give
  it top priority` reorders, and `ls` marks the rest "fresh, over the cap".
- **`window`** is `today` (local calendar day), `24h`, or `7d`.
- **`linkContains`** filters by item link. KSBD's feed carries both comic pages
  and "next update Thursday" news posts; `/comic/` counts only the comics.

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
