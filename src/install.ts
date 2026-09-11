/** Wiring emoji-rss into the shell: write the hook, source it from ~/.zshrc. */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import snippet from "../shell/emoji-rss.zsh" with { type: "text" };
import { CONFIG_DIR, SHELL_SNIPPET } from "./config.ts";

export const ZSHRC = join(homedir(), ".zshrc");

/** What ~/.zshrc needs, and what we grep for to tell if it is already there. */
export const SOURCE_LINE = `[ -f "${SHELL_SNIPPET}" ] && source "${SHELL_SNIPPET}"`;
const MARKER = "emoji-rss";

/** Write the hook, but only when it is missing or out of date after a rebuild. */
export async function ensureSnippet(): Promise<"written" | "current"> {
  const file = Bun.file(SHELL_SNIPPET);
  if ((await file.exists()) && (await file.text()) === snippet) return "current";
  mkdirSync(CONFIG_DIR, { recursive: true });
  await Bun.write(SHELL_SNIPPET, snippet);
  return "written";
}

export async function zshrcSourcesSnippet(): Promise<boolean> {
  const file = Bun.file(ZSHRC);
  if (!(await file.exists())) return false;
  const text = await file.text();
  return text.includes(SHELL_SNIPPET) || new RegExp(`source.*${MARKER}\\.zsh`).test(text);
}

/**
 * Append the source line. No backup: this only ever adds two commented lines to
 * the end of the file, so undoing it is deleting them.
 */
export async function patchZshrc(): Promise<void> {
  const file = Bun.file(ZSHRC);
  const existing = (await file.exists()) ? await file.text() : "";
  const block = [
    "",
    "# emoji-rss: prompt emoji driven by RSS/Atom feeds (`emoji-rss` to edit)",
    SOURCE_LINE,
    "",
  ].join("\n");
  await Bun.write(ZSHRC, existing.replace(/\n*$/, "\n") + block);
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
