/**
 * Wire framing for the dsh-terminal WebSocket channel.
 *
 * Browser → host: text JSON control/input frames.
 *   { t: 'open',  cols, rows }   open a fresh PTY on this socket (also re-opens
 *                                after the previous one exited — used by the
 *                                tab "restart" action)
 *   { t: 'input', d: string }    raw keystrokes / pasted text for the PTY
 *   { t: 'resize', cols, rows }  window-size change (from xterm fit)
 *
 * Host → browser:
 *   binary frame                raw PTY output bytes (written straight into xterm)
 *   text JSON events:
 *     { t: 'ready', pid, shell, cwd }      after a PTY spawn succeeded
 *     { t: 'exit', code?, signal? }        the PTY exited; socket stays open
 *     { t: 'error', message }              fatal/session-level error
 *
 * Frames are small and strictly sized on input so the parser stays trivial
 * and a flood cannot grow memory: input payload ≤ 64 KiB.
 */

/** Hard geometry bounds (xterm supports up to 500 cols / 300 rows). */
export const MAX_COLS = 500
export const MAX_ROWS = 300
export const MAX_INPUT_BYTES = 64 * 1024

export interface OpenMessage {
  t: 'open'
  cols: number
  rows: number
  /**
   * Optional absolute directory the shell should start in. The browser sends
   * the current dsh workspace root when it can resolve one; the host still
   * validates it (exists + directory) before trusting it.
   */
  cwd?: string
}

export interface InputMessage {
  t: 'input'
  d: string
}

export interface ResizeMessage {
  t: 'resize'
  cols: number
  rows: number
}

export type ClientMessage = OpenMessage | InputMessage | ResizeMessage

/** Result of one parse: a valid message, or a close-code + human reason. */
export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: number; reason: string }

/** Clamp a requested geometry into the protocol bounds (ints only). */
export function clampGeometry(cols: number, rows: number): { cols: number; rows: number } {
  const c = Number.isFinite(cols) ? Math.floor(cols) : 80
  const r = Number.isFinite(rows) ? Math.floor(rows) : 24
  return { cols: Math.min(MAX_COLS, Math.max(2, c)), rows: Math.min(MAX_ROWS, Math.max(1, r)) }
}

function bad(code: number, reason: string): ParseResult {
  return { ok: false, code, reason }
}

/** Parse a client text frame. Unknown shapes close with 1008 (policy). */
export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== 'string') return bad(1003, 'expected a text frame')
  if (raw.length > 64 * 1024) return bad(1009, 'frame too large')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return bad(1008, 'malformed JSON frame')
  }
  if (typeof body !== 'object' || body === null) return bad(1008, 'frame must be an object')
  const msg = body as Record<string, unknown>
  const t = msg.t
  if (t === 'open') {
    if (typeof msg.cols !== 'number' || typeof msg.rows !== 'number') return bad(1008, 'open needs cols/rows')
    const cwd = msg.cwd
    if (cwd !== undefined && typeof cwd !== 'string') return bad(1008, 'open cwd must be a string')
    const open: OpenMessage = { t: 'open', ...clampGeometry(msg.cols, msg.rows) }
    if (typeof cwd === 'string' && cwd.length > 0 && cwd.length <= 4096 && !cwd.includes('\0')) open.cwd = cwd
    return { ok: true, message: open }
  }
  if (t === 'resize') {
    if (typeof msg.cols !== 'number' || typeof msg.rows !== 'number') return bad(1008, 'resize needs cols/rows')
    return { ok: true, message: { t: 'resize', ...clampGeometry(msg.cols, msg.rows) } }
  }
  if (t === 'input') {
    if (typeof msg.d !== 'string') return bad(1008, 'input needs a string payload')
    if (Buffer.byteLength(msg.d, 'utf8') > MAX_INPUT_BYTES) return bad(1009, 'input too large')
    return { ok: true, message: { t: 'input', d: msg.d } }
  }
  return bad(1008, `unknown frame type ${JSON.stringify(t)}`)
}
