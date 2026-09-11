/** Hand a url to whatever the OS considers the browser. */
import { spawn } from "node:child_process";

export function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  // Detached: the CLI should not sit around waiting for a browser to exit.
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}
