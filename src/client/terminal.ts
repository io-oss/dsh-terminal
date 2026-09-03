/**
 * Terminal session host: one xterm instance + one WebSocket per tab.
 *
 * This module owns the non-React runtime of a terminal tab — xterm wiring,
 * the /dsh-terminal/ws channel (binary output → xterm, JSON control frames),
 * resize/fit bookkeeping, reconnect with exponential backoff, and live
 * appearance/theme updates. The dock renders one container per session and
 * calls into this module; session state mirrors into the panel store so the
 * tab bar can render status.
 */

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import { buildTerminalTheme, resolveCodeFontStack, MONO_FALLBACK } from './xterm-theme.ts'
import { updateSession, type SessionRecord } from './store.ts'

/** Appearance applied to every terminal (kept in sync with the settings scope). */
export interface TerminalAppearance {
  fontFamily: string
  fontSize: number
}

const decoder = new TextDecoder()

const RECONNECT_BASE_MS = 500
const RECONNECT_CAP_MS = 8000
const MAX_QUEUED_INPUT = 128 * 1024

function terminalWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/dsh-terminal/ws`
}

let appearance: TerminalAppearance = {
  fontFamily: '',
  fontSize: 13,
}

/** Current terminal appearance (defaults to the GUI code font until overridden). */
export function getAppearance(): TerminalAppearance {
  if (appearance.fontFamily === '') return { ...appearance, fontFamily: resolveCodeFontStack() }
  return appearance
}

/** Apply new appearance to all live terminals and refit them. */
export function setAppearance(next: TerminalAppearance): void {
  appearance = {
    fontFamily: next.fontFamily.trim() === '' ? '' : next.fontFamily,
    fontSize: next.fontSize,
  }
  for (const session of sessions.values()) session.applyAppearance()
}

/** Resolves the directory a newly opened shell should start in (current workspace). */
export type WorkspaceRootProvider = () => string | undefined

let workspaceRootProvider: WorkspaceRootProvider | undefined

/** Install/clear the workspace-root provider (wired from the plugin entry). */
export function setWorkspaceRootProvider(provider: WorkspaceRootProvider | undefined): void {
  workspaceRootProvider = provider
}

/** Best-effort current workspace directory for a fresh shell. */
function currentWorkspaceRoot(): string | undefined {
  const provider = workspaceRootProvider
  if (provider === undefined) return undefined
  try {
    return provider()
  } catch {
    return undefined
  }
}

function labelFromShell(shell: string | undefined, pid: number | undefined): string {
  const base = shell === undefined ? '' : shell.split('/').filter(Boolean).pop() ?? ''
  return base === '' ? '…' : pid === undefined ? base : `${base} · ${String(pid)}`
}

interface ServerReady {
  t: 'ready'
  pid: number
  shell: string
  cwd: string
}

interface ServerExit {
  t: 'exit'
  code?: number
  signal?: number
}

interface ServerError {
  t: 'error'
  message: string
}

type ServerEvent = ServerReady | ServerExit | ServerError

class TerminalSession {
  readonly id: string
  private readonly term: Terminal
  private readonly fit: FitAddon
  private container: HTMLElement | null = null
  private ws: WebSocket | null = null
  private resizeObserver: ResizeObserver | null = null
  private frame: number | null = null

  private disposed = false
  private seenShell = false
  private ptyReady = false
  private queuedInput: string[] = []
  private queuedInputBytes = 0
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(id: string) {
    this.id = id
    const current = getAppearance()
    this.term = new Terminal({
      fontFamily: current.fontFamily || MONO_FALLBACK,
      fontSize: current.fontSize,
      theme: buildTerminalTheme(),
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      convertEol: false,
    })
    this.fit = new FitAddon()
    this.term.loadAddon(this.fit)
    this.term.onData((data) => this.handleInput(data))
  }

  // ---- lifecycle -------------------------------------------------------

  /** Mount the xterm instance into its container and start the channel. */
  mount(container: HTMLElement): void {
    if (this.container === container) return
    if (this.container !== null) {
      // Moving terminals between containers is not supported by the dock;
      // drop the stale socket rather than leak it.
      this.closeChannel()
    }
    this.container = container
    this.term.open(container)
    this.observeContainer(container)
    this.scheduleFit()
    this.connect()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.closeChannel()
    try {
      this.term.dispose()
    } catch {
      // xterm already torn down.
    }
    this.container = null
  }

  /** User-visible restart: respawn the shell after it exited or failed. */
  restart(): void {
    if (this.disposed) return
    this.queuedInput = []
    this.queuedInputBytes = 0
    this.attempts = 0
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.term.reset()
    const ws = this.ws
    if (ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      if (ws.readyState === WebSocket.OPEN) this.sendOpen()
    } else {
      this.connect()
    }
  }

  // ---- channel ---------------------------------------------------------

  private connect(): void {
    if (this.disposed) return
    this.closeChannel(false)
    // Status stays as the caller left it ('connecting' on first open, then the
    // close handler's 'reconnecting'); sendOpen() flips to 'connecting' once
    // the handshake completes. No store writes during the commit phase.
    let socket: WebSocket
    try {
      socket = new WebSocket(terminalWsUrl())
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = socket
    socket.addEventListener('open', () => {
      if (this.disposed || this.ws !== socket) return
      this.attempts = 0
      // A rebuilt PTY starts a fresh shell: drop the stale scrollback so the
      // reconnected terminal does not mix old output with the new session.
      if (this.seenShell) this.term.reset()
      this.sendOpen()
    })
    socket.addEventListener('message', (event) => this.handleMessage(event))
    socket.addEventListener('close', (event) => {
      if (this.ws !== socket) return
      this.ws = null
      this.ptyReady = false
      if (this.disposed) return
      if (event.code === 1008 || event.code === 1009 || event.code === 1011) {
        this.setStatus('error', { error: event.reason || `closed (${String(event.code)})` })
        return
      }
      this.setStatus('reconnecting', {})
      this.scheduleReconnect()
    })
    socket.addEventListener('error', () => {
      // The close event that follows drives the reconnect state.
    })
  }

  private closeChannel(markClosed = true): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.ws
    this.ws = null
    if (ws !== null) {
      if (markClosed) {
        try {
          ws.close()
        } catch {
          // Already closing.
        }
      } else {
        try {
          ws.close(1000, 'channel replaced')
        } catch {
          // Ignore.
        }
      }
    }
    this.ptyReady = false
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    const delay = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** this.attempts)
    this.attempts = Math.min(8, this.attempts + 1)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private sendOpen(): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return
    const dims = this.currentDims()
    const cwd = currentWorkspaceRoot()
    this.setStatus('connecting', {})
    this.sendJson(cwd === undefined
      ? { t: 'open', cols: dims.cols, rows: dims.rows }
      : { t: 'open', cols: dims.cols, rows: dims.rows, cwd })
  }

  private handleInput(data: string): void {
    if (this.ptyReady && this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.sendJson({ t: 'input', d: data })
      return
    }
    const bytes = new TextEncoder().encode(data).byteLength
    if (this.queuedInputBytes + bytes > MAX_QUEUED_INPUT) return
    this.queuedInput.push(data)
    this.queuedInputBytes += bytes
  }

  private flushInput(): void {
    if (this.queuedInput.length === 0) return
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN || !this.ptyReady) return
    const combined = this.queuedInput.join('')
    this.queuedInput = []
    this.queuedInputBytes = 0
    for (let offset = 0; offset < combined.length; offset += 60 * 1024) {
      this.sendJson({ t: 'input', d: combined.slice(offset, offset + 60 * 1024) })
    }
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    const data = event.data
    if (typeof data === 'string') {
      this.handleServerEvent(data)
      return
    }
    // Binary frames are raw PTY output.
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data as ArrayBuffer)
    this.term.write(decoder.decode(bytes, { stream: true }))
  }

  private handleServerEvent(raw: string): void {
    let event: ServerEvent
    try {
      event = JSON.parse(raw) as ServerEvent
    } catch {
      return
    }
    if (event.t === 'ready') {
      this.ptyReady = true
      this.seenShell = true
      this.queuedInputBytes = 0
      this.flushInput()
      this.setStatus('ready', {
        pid: event.pid,
        shell: event.shell,
        cwd: event.cwd,
        label: labelFromShell(event.shell, event.pid),
      })
      this.scheduleFit()
      return
    }
    if (event.t === 'exit') {
      this.ptyReady = false
      this.setStatus('ended', {})
      return
    }
    if (event.t === 'error') {
      this.ptyReady = false
      this.setStatus('error', { error: event.message })
    }
  }

  private setStatus(status: SessionRecord['status'], extras: Partial<SessionRecord>): void {
    if (this.disposed) return
    updateSession(this.id, { status, ...extras })
  }

  // ---- geometry / appearance -------------------------------------------

  private currentDims(): { cols: number; rows: number } {
    return { cols: Math.max(2, this.term.cols), rows: Math.max(1, this.term.rows) }
  }

  private sendResize(): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN || !this.ptyReady) return
    const dims = this.currentDims()
    this.sendJson({ t: 'resize', cols: dims.cols, rows: dims.rows })
  }

  private scheduleFit(): void {
    if (this.frame !== null || this.disposed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      try {
        const previous = { cols: this.term.cols, rows: this.term.rows }
        this.fit.fit()
        if (previous.cols !== this.term.cols || previous.rows !== this.term.rows) this.sendResize()
      } catch {
        // Container is hidden (zero size) — the observer refits on reveal.
      }
    })
  }

  private observeContainer(container: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver?.disconnect()
    this.resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) this.scheduleFit()
    })
    this.resizeObserver.observe(container)
  }

  applyAppearance(): void {
    const current = getAppearance()
    this.term.options.fontFamily = current.fontFamily || MONO_FALLBACK
    this.term.options.fontSize = current.fontSize
    this.scheduleFit()
  }

  refreshTheme(): void {
    this.term.options.theme = buildTerminalTheme()
    this.scheduleFit()
  }

  focus(): void {
    this.term.focus()
  }

  clear(): void {
    this.term.clear()
  }

  copySelection(): void {
    const selection = this.term.getSelection()
    if (selection === '') return
    void navigator.clipboard?.writeText(selection).catch(() => {
      // Clipboard permission denied; user can still select manually.
    })
  }

  async pasteClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText()
      if (text !== '') this.term.paste(text)
    } catch {
      // Reading the clipboard requires focus/permission; nothing to do.
    }
  }

  private sendJson(payload: unknown): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }
}

const sessions = new Map<string, TerminalSession>()

/** Attach (or create and attach) the session for `id` into `container`. */
export function attachSession(id: string, container: HTMLElement): void {
  let session = sessions.get(id)
  if (session === undefined) {
    session = new TerminalSession(id)
    sessions.set(id, session)
  }
  session.mount(container)
}

/** Drop a session (tab closed): kills the PTY via the channel close. */
export function detachSession(id: string): void {
  const session = sessions.get(id)
  if (session !== undefined) {
    sessions.delete(id)
    session.dispose()
  }
}

/** Restart the shell of one tab (used by the "restart" action on ended tabs). */
export function restartSession(id: string): void {
  sessions.get(id)?.restart()
}

/** Re-apply appearance (font family/size) to every live terminal. */
export function applyAppearanceToAll(): void {
  for (const session of sessions.values()) session.applyAppearance()
}

/** Rebuild xterm themes after a GUI theme change. */
export function applyThemeToAll(): void {
  for (const session of sessions.values()) session.refreshTheme()
}

/** Focus the given session's terminal (returns whether it exists). */
export function focusSession(id: string | null): boolean {
  const session = id === null ? undefined : sessions.get(id)
  if (session === undefined) return false
  session.focus()
  return true
}

export function clearSession(id: string | null): void {
  if (id !== null) sessions.get(id)?.clear()
}

export function copySession(id: string | null): void {
  if (id !== null) sessions.get(id)?.copySelection()
}

export function pasteSession(id: string | null): void {
  if (id !== null) void sessions.get(id)?.pasteClipboard()
}

/** Terminal registry is module state only; no public read needed by React. */
export function sessionExists(id: string): boolean {
  return sessions.has(id)
}
