/** Wiring emoji-rss into the shell: write the hook, source it from ~/.zshrc. */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, copyFileSync } from "node:fs";
import snippet from "../shell/emoji-rss.zsh" with { type: "text" };
import { CONFIG_DIR, SHELL_SNIPPET } from "./config.ts";

export const ZSHRC = join(homedir(), ".zshrc");

/** What ~/.zshrc needs, and what we grep for to tell if it is already there. */
export const SOURCE_LINE = `[ -f "${SHELL_SNIPPET}" ] && source "${SHELL_SNIPPET}"`;
const MARKER = "emoji-rss";

export async function writeSnippet(): Promise<string> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(SHELL_SNIPPET, snippet);
  return SHELL_SNIPPET;
}

export async function zshrcSourcesSnippet(): Promise<boolean> {
  const file = Bun.file(ZSHRC);
  if (!(await file.exists())) return false;
  const text = await file.text();
  return text.includes(SHELL_SNIPPET) || new RegExp(`source.*${MARKER}\\.zsh`).test(text);
}

/** Append the source line, keeping a timestamped backup of the original. */
export async function patchZshrc(): Promise<{ backup: string }> {
  const file = Bun.file(ZSHRC);
  const existing = (await file.exists()) ? await file.text() : "";
  const backup = `${ZSHRC}.emoji-rss.bak`;
  if (existing) copyFileSync(ZSHRC, backup);
  const block = [
    "",
    "# emoji-rss: prompt emoji driven by RSS/Atom feeds (`emoji-rss` to edit)",
    SOURCE_LINE,
    "",
  ].join("\n");
  await Bun.write(ZSHRC, existing.replace(/\n*$/, "\n") + block);
  return { backup };
}

/** Shown for prompts we do not edit ourselves (bash, a Claude Code statusline). */
export function otherShellSnippet(cachePath: string): string {
  return [
    `emoji=$(cat "${cachePath}" 2>/dev/null)`,
    `[ -z "$emoji" ] && emoji="🔥"`,
    `# refresh when the cache is older than 30 min, detached so nothing blocks`,
    `if [ ! -f "${cachePath}" ] || [ "$(( $(date +%s) - $(stat -f %m "${cachePath}" 2>/dev/null || echo 0) ))" -gt 1800 ]; then`,
    `  ( emoji-rss check --quiet >/dev/null 2>&1 & ) >/dev/null 2>&1`,
    `fi`,
  ].join("\n");
}
