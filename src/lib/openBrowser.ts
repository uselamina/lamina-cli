/**
 * Cross-platform browser open. Lifted from the pattern used by `gh`,
 * `supabase`, `vercel` — `open` on macOS, `xdg-open` on Linux, `start` on
 * Windows. Returns `{ launched }` so the caller can fall back to printing
 * the URL when no graphical environment is available (SSH/CI/containers).
 */
import { spawn } from 'node:child_process';

export interface OpenBrowserResult {
  launched: boolean;
}

function looksHeadless(): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') return false;
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return true;
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return true;
  return false;
}

export async function openBrowser(url: string): Promise<OpenBrowserResult> {
  if (looksHeadless()) return { launched: false };

  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    return { launched: true };
  } catch {
    return { launched: false };
  }
}
