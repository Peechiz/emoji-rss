/** Colors via Bun.Color, so the palette lives as hex in one place. */

const RESET = "\x1b[0m";
// FORCE_COLOR keeps `emoji-rss ls | less -R` readable; NO_COLOR always wins.
const useColor = () =>
  !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));

const palette = {
  hit: "#22c55e",
  warn: "#eab308",
  danger: "#ef4444",
  accent: "#22d3ee",
  muted: "#8b8b93",
  heading: "#e4e4e7",
} as const;

type Tone = keyof typeof palette;

const codes = new Map<Tone, string>();
for (const [tone, hex] of Object.entries(palette)) {
  codes.set(tone as Tone, Bun.color(hex, "ansi") ?? "");
}

const paint =
  (tone: Tone) =>
  (s: string): string =>
    useColor() ? `${codes.get(tone) ?? ""}${s}${RESET}` : s;

export const c = {
  green: paint("hit"),
  yellow: paint("warn"),
  red: paint("danger"),
  cyan: paint("accent"),
  dim: paint("muted"),
  bold: (s: string) => (useColor() ? `\x1b[1m${s}${RESET}` : s),
  title: (s: string) => (useColor() ? `\x1b[1m${codes.get("heading")}${s}${RESET}` : s),
};

export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** Pad to a visible column width; Bun.stringWidth counts emoji as two columns. */
export function pad(s: string, width: number, min = 2): string {
  return s + " ".repeat(Math.max(min, width - Bun.stringWidth(s)));
}

/** Cut to a visible width, marking the cut so a truncated name is obvious. */
export function trunc(s: string, width: number): string {
  if (Bun.stringWidth(s) <= width) return s;
  return `${s.slice(0, Math.max(1, width - 1))}…`;
}
