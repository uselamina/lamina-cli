import { spawn } from 'node:child_process';

/**
 * Cross-platform "open this URL in the user's default browser."
 *
 * Uses the OS-native open command (no third-party deps):
 *   - macOS:   `open <url>`
 *   - Linux:   `xdg-open <url>`
 *   - Windows: `start "" "<url>"` (via cmd.exe)
 *
 * Best-effort. If the open command fails (no GUI, restricted env, headless
 * server), we log a warning and tell the caller via the return value, so the
 * caller can fall back to printing the URL for manual visit.
 *
 * Mirrors how `gh auth login`, `vercel login`, `stripe login` handle browser
 * launch — they all show the URL in terminal AND attempt to auto-open.
 */
export async function openBrowser(url: string): Promise<{ launched: boolean }> {
  try {
    new URL(url);
  } catch {
    return { launched: false };
  }

  const platform = process.platform;

  // Detect headless / no-DGUI environments where opening would be pointless
  // and could even spew errors. Heuristic: SSH session + no DISPLAY (Linux).
  const isHeadlessSsh =
    platform === 'linux' && !process.env.DISPLAY && Boolean(process.env.SSH_CONNECTION);
  if (isHeadlessSsh) {
    return { launched: false };
  }

  let cmd: string;
  let args: string[];

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    // `start` is a cmd builtin, not an exe. The empty "" is the window title
    // — required when the URL contains spaces or special chars.
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    // Linux + everything else — try xdg-open.
    cmd = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', () => resolve({ launched: false }));
      // Don't keep the parent process alive waiting for the browser to close.
      child.unref();
      // The spawn is synchronous from our side; if it didn't error in the
      // same tick we assume it launched.
      setImmediate(() => resolve({ launched: true }));
    } catch {
      resolve({ launched: false });
    }
  });
}
