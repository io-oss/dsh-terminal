/**
 * Module-level panel store for the terminal dock.
 *
 * This is a tiny external store (subscribe/getSnapshot + useSyncExternalStore)
 * shared by every surface of the plugin bundle — the sidebar toggle button,
 * the shell.overlay dock, the settings section and the Ctrl+` listener —
 * without depending on the host store runtime. `open` is transient (a reload
 * starts with the panel closed; sessions never survive a reload anyway),
 * while `height` is persisted so dragging feels stable across sessions.
 */

import { useSyncExternalStore } from 'react'

export type SessionStatus = 'connecting' | 'ready' | 'reconnecting' | 'ended' | 'error'

export interface SessionRecord {
  id: string
  status: SessionStatus
  label: string
  pid?: number
  shell?: string
  cwd?: string
  error?: string
}

export interface PanelState {
  open: boolean
  height: number
  sessions: SessionRecord[]
  activeId: string | null
}

/** Height bounds of the docked panel (px). */
export const PANEL_MIN_HEIGHT = 120
export const PANEL_MAX_HEIGHT = 520
export const PANEL_DEFAULT_HEIGHT = 240

const VIEW_KEY = 'dsh-terminal.view'

function readPersistedHeight(): number {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY)
    if (raw === null) return PANEL_DEFAULT_HEIGHT
    const value = Number.parseInt(raw, 10)
    if (!Number.isFinite(value)) return PANEL_DEFAULT_HEIGHT
    return Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, value))
  } catch {
    return PANEL_DEFAULT_HEIGHT
  }
}

let state: PanelState = {
  open: false,
  height: readPersistedHeight(),
  sessions: [],
  activeId: null,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribePanel(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPanel(): PanelState {
  return state
}

function update(mutator: (previous: PanelState) => Partial<PanelState>): void {
  const patch = mutator(state)
  state = { ...state, ...patch }
  emit()
}

function persistHeight(height: number): void {
  try {
    window.localStorage.setItem(VIEW_KEY, String(Math.round(height)))
  } catch {
    // Storage unavailable (private mode) — height just stays in memory.
  }
}

let nextSessionNumber = 1

function makeSessionRecord(): SessionRecord {
  const id = `term-${Date.now().toString(36)}-${String(nextSessionNumber)}`
  nextSessionNumber += 1
  return { id, status: 'connecting', label: '' }
}

/** Create a terminal tab record (the real session attaches when the dock mounts it). */
export function addSession(): string {
  const record = makeSessionRecord()
  update((previous) => ({
    sessions: [...previous.sessions, record],
    activeId: record.id,
  }))
  return record.id
}

export function updateSession(id: string, patch: Partial<SessionRecord>): void {
  update((previous) => ({
    sessions: previous.sessions.map((session) => (session.id === id ? { ...session, ...patch } : session)),
  }))
}

export function removeSession(id: string): void {
  update((previous) => {
    const sessions = previous.sessions.filter((session) => session.id !== id)
    return {
      sessions,
      activeId: previous.activeId === id ? (sessions.length > 0 ? sessions[sessions.length - 1].id : null) : previous.activeId,
    }
  })
}

export function setActiveSession(id: string): void {
  update(() => ({ activeId: id }))
}

export function openPanel(): void {
  update(() => ({ open: true }))
  const panel = getPanel()
  if (panel.sessions.length === 0) addSession()
}

export function hidePanel(): void {
  update(() => ({ open: false }))
}

export function togglePanel(): void {
  if (getPanel().open) hidePanel()
  else openPanel()
}

export function setPanelHeight(height: number): void {
  const clamped = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(height)))
  update(() => ({ height: clamped }))
  persistHeight(clamped)
}

export function panelIsMaximized(): boolean {
  return getPanel().height >= PANEL_MAX_HEIGHT
}

/** React hook over the module store (snapshot = stable object per change). */
export function usePanelStore<T>(selector: (snapshot: PanelState) => T): T {
  return useSyncExternalStore(subscribePanel, () => selector(getPanel()))
}
