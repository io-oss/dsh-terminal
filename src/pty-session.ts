/**
 * Local node-pty terminal-process implementation for the dsh-terminal plugin.
 *
 * Spawns one interactive shell per WebSocket session with a real PTY
 * (`name: 'xterm-256color'`), streams raw output, accepts writes and resizes.
 * Environment scrubbing mirrors the host's own rule for child processes
 * (drop KEY/PASSWORD/SECRET/TOKEN and `DSH_*` variables) so nothing
 * harness-sensitive leaks into the user's shell.
 */

import * as pty from 'node-pty'
import type { IPty } from 'node-pty'

/** Variable names that look like secrets and are dropped from the shell env. */
const SENSITIVE_ENV = /(?:KEY|PASSWORD|PASSWD|SECRET|TOKEN)/i

/** Harness-owned variables never forwarded to the shell. */
const DSH_PREFIX = /^DSH_/

/** Exit payload as node-pty reports it (numbers may be undefined). */
export interface PtyExitInfo {
  exitCode: number | undefined
  signal: number | undefined
}

export interface PtySessionEvents {
  onData: (chunk: Buffer) => void
  onExit: (info: PtyExitInfo) => void
}

/** Spawn options for one terminal session. */
export interface PtySpawnOptions {
  shell: string
  cols: number
  rows: number
  cwd: string
  env?: Record<string, string>
}

/**
 * Build the child environment from the current process env minus secret-ish
 * and DSH-owned keys (same rule dsh uses for subprocesses), then force a real
 * color terminal so interactive programs pick the right behaviour.
 */
export function cleanShellEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV.test(key)) continue
    if (DSH_PREFIX.test(key)) continue
    out[key] = value
  }
  out.TERM = 'xterm-256color'
  out.COLORTERM = 'truecolor'
  if (out.LANG === undefined) out.LANG = 'C.UTF-8'
  return out
}

/** Resolve the login shell: `$SHELL` when usable, else the platform default. */
export function resolveShell(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === 'win32') return env.COMSPEC ?? 'powershell.exe'
  const candidate = env.SHELL
  if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  return '/bin/bash'
}

/**
 * One PTY session. Owns the node-pty process for exactly one WebSocket
 * session and forwards the three events the wire protocol needs. All calls
 * are safe to make from the same event loop; kill() tolerates double calls.
 */
export class PtySession {
  private readonly proc: IPty

  /** Start-of-session identity the client shows in the tab label. */
  readonly pid: number
  readonly shell: string
  readonly cwd: string

  onData: PtySessionEvents['onData'] = () => {}
  onExit: PtySessionEvents['onExit'] = () => {}

  constructor(options: PtySpawnOptions) {
    this.shell = options.shell
    this.cwd = options.cwd
    this.proc = pty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env ?? cleanShellEnv(),
    })
    this.pid = this.proc.pid
    this.proc.onData((data) => {
      this.onData(Buffer.from(data, 'utf8'))
    })
    this.proc.onExit(({ exitCode, signal }) => {
      this.onExit({ exitCode, signal })
    })
  }

  /** Forward one chunk of raw input bytes from the browser. */
  write(data: string): void {
    try {
      this.proc.write(data)
    } catch {
      // Process already gone; the exit event will settle the session.
    }
  }

  /** Resize the PTY window (cols/rows are clamped by the caller). */
  resize(cols: number, rows: number): void {
    try {
      this.proc.resize(cols, rows)
    } catch {
      // Resize after exit is a no-op.
    }
  }

  /** Ask the shell to terminate. */
  kill(): void {
    try {
      this.proc.kill()
    } catch {
      // Already dead.
    }
  }
}
