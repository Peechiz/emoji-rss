# Deferred: a searchable emoji picker

Status: **not built**. The emoji prompt in `add` is a free-text input. This note
exists so picking it back up is cheap.

## The itch

Picking an emoji means knowing one and typing it. macOS has cmd+ctrl+space:
type a word, see candidates, arrow between them, enter. The same thing in the
terminal would be better than free text.

## The primitive already exists

`@clack/prompts` exports `autocomplete` (v1.8.0, already a dependency). It is a
text input wired to a filtered list:

```ts
const emoji = await autocomplete({
  message: `emoji for ${name}`,
  options: EMOJI,                          // { value: "🎙", label: "microphone", hint: "podcast, radio" }
  filter: (search, option) => …,           // the fuzzy matcher goes here
  maxItems: 8,
});
```

Type → filters live. Up/down → move. Enter → pick. `filter` is the whole
extension point: subsequence matching, keyword aliases, ranking, whatever.

`@clack/core` also exports the base `Prompt` class, plus `AutocompletePrompt`,
if a stock one ever needs subclassing.

## The one thing it won't do

`autocomplete` renders candidates as a **vertical list** of `maxItems` rows.
There is no knob for a single horizontal strip like the macOS picker. Getting
that means subclassing `Prompt` from `@clack/core` and writing the render
function -- doable, but that is writing a prompt rather than configuring one.

Probably not worth it. Eight vertical rows carry the names too:

```
🎙  microphone      podcast, radio, studio
🎧  headphone       audio, listen
📻  radio           broadcast, news
```

A horizontal strip shows glyphs alone, and a bare 🎙 next to 🎤 is a coin flip.

## The actual work is the data

The UI change is one call. The dataset is the real task: emoji → name →
searchable keywords.

Candidates, both data-only and offline at runtime:

- `emojilib` -- emoji → keyword arrays, roughly 1,900 entries
- `unicode-emoji-json` -- emoji → canonical name, group, version

Check their installed size when you get there; whatever it is, it is noise
against the ~64MB Bun runtime already inside the compiled binary. Nothing here
needs the network -- it bundles into `emoji-rss` like `shell/emoji-rss.zsh` does.

Worth filtering the set down: skin-tone and gender variants trash the results,
and anything above about Unicode 13 is a gamble on terminal font coverage.

## Sketch

1. `src/emoji.ts` -- load the dataset, flatten to `{ char, name, keywords[] }`,
   drop variants.
2. Fuzzy match: exact name first, then name prefix, then keyword hit, then
   subsequence. Rank in that order; `filter` is a boolean, so sort `options`
   ahead of time or pass a function for `options`.
3. Swap the `text({ message: \`emoji for ${name}\` })` call in `addFeed` for
   `autocomplete`. Same swap in `editFeed`'s emoji branch and `setFallback`.
4. Keep free text reachable -- some feed deserves an emoji the dataset lacks.
   Either a "type it yourself" entry in the list, or accept unmatched input.

The existing `validEmoji` check (non-empty, no spaces, `Bun.stringWidth <= 2`)
still applies either way.

## How to decide

Live with free text for a while. If adding a feed keeps stalling on "what emoji
do I even want", build it. If the answer is obvious every time, this is a
solution to nothing.
