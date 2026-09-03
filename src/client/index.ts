/**
 * dsh-terminal client entry: wires the three UI surfaces (bottom dock,
 * sidebar toggle, settings section) into the host slot system, keeps the
 * terminal appearance in sync with the `dsh-terminal` settings scope, follows
 * GUI theme changes, injects the embedded xterm stylesheet and handles the
 * Ctrl+` panel shortcut.
 *
 * Built by scripts/build-client.mjs into the __ModuleLoader__ factory bundle
 * at client/client.js; react and the host primitives stay external.
 */

import { createElement as h } from 'react'
import { en, zh } from './locales.ts'
import { TerminalDock } from './TerminalDock.tsx'
import { TerminalButton } from './TerminalButton.tsx'
import { TerminalSettings } from './TerminalSettings.tsx'
import type { TerminalScope, TerminalSettingsValue } from './TerminalSettings.tsx'
import { XTERM_CSS } from './xterm-css.ts'
import { setAppearance, applyAppearanceToAll, applyThemeToAll, setWorkspaceRootProvider } from './terminal.ts'
import { togglePanel } from './store.ts'

const NS = 'dsh-terminal'

/** The subset of the locale service this plugin touches. */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
}

/** The subset of the slots service this plugin touches. */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: unknown): unknown
}

/** The subset of the settingsScope service this plugin touches. */
interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string }): TerminalScope<T>
}

/** The client cordis context shape this plugin relies on. */
interface TerminalClientContext {
  effect(callback: () => unknown, label?: string): void
  on(event: string, callback: (payload?: unknown) => void): () => void
  inject(names: string[], callback: (ctx: unknown) => unknown): unknown
  locale: LocaleService
  slots: SlotsService
  settingsScope: SettingsScopeBinder
}

export const name = 'dsh-terminal'
// Object-form service injection; the package-level dsh.client.inject list
// orders the bundle graph so the providers apply before this plugin.
export const inject = ['slots', 'locale', 'settingsScope', 'theme']

/** Clamp the persisted font size into the schema range. */
function clampFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(32, Math.max(8, value)) : 13
}

/** Loose shapes of the host session/workspace mirrors (browser-safe subset). */
interface SessionSummaryLike {
  id?: string
  cwd?: string
  blank?: boolean
}

interface WorkspaceLike {
  workspaceId?: string
  path?: string
  createdAt?: string
  updatedAt?: string
  sessionIds?: readonly string[]
}

interface WorkspaceHost {
  sessions?: { list?: { getSnapshot?: () => { current?: string; byId?: Record<string, SessionSummaryLike> } } }
  workspaces?: { getSnapshot?: () => { items?: WorkspaceLike[] } }
}

/**
 * Resolve the directory of the "current workspace":
 *
 * 1. the current session's own working directory (`summary.cwd` — the host
 *    records each session's workspace root there);
 * 2. otherwise the workspace owning the current session in the workspaces
 *    mirror, or the most recently touched workspace;
 * 3. otherwise undefined (the host then falls back to its own policy root).
 */
function currentWorkspaceRoot(host: WorkspaceHost): string | undefined {
  try {
    const snapshot = host.sessions?.list?.getSnapshot?.()
    const currentId = snapshot?.current
    if (typeof currentId === 'string') {
      const summary = snapshot?.byId?.[currentId]
      const cwd = summary?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    const items = host.workspaces?.getSnapshot?.()?.items
    if (Array.isArray(items) && items.length > 0) {
      const owned = typeof currentId === 'string'
        ? items.find((workspace) => workspace.sessionIds?.includes(currentId) === true)
        : undefined
      const chosen = owned ?? [...items].sort((left, right) =>
        (right.updatedAt ?? right.createdAt ?? '').localeCompare(left.updatedAt ?? left.createdAt ?? ''),
      )[0]
      const path = chosen?.path
      if (typeof path === 'string' && path !== '') return path
    }
    return undefined
  } catch {
    return undefined
  }
}

export function apply(ctx: TerminalClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-terminal: dictionaries')
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<TerminalSettingsValue>({ namespace: NS })

  // Optional: resolve the current workspace directory so freshly opened shells
  // start there instead of the host process cwd. Only `sessions` is required;
  // the workspaces mirror (if present) is used as a fallback source.
  ctx.inject(['sessions'], (hostCtx: unknown) => {
    const host = hostCtx as WorkspaceHost
    setWorkspaceRootProvider(() => currentWorkspaceRoot(host))
    return () => setWorkspaceRootProvider(undefined)
  })

  // Embed the xterm stylesheet as an owned <style> tag (host CSS convention).
  ctx.effect(() => {
    const tagId = 'dsh-terminal/xterm.css'
    const existing = document.querySelector(`style[data-plugin-css="${CSS.escape(tagId)}"]`)
    if (existing !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = NS
    tag.dataset.pluginCss = tagId
    tag.textContent = XTERM_CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-terminal: xterm stylesheet')

  // Keep the terminal appearance (font family + size) in sync with settings.
  ctx.effect(() => {
    const sync = () => {
      const value = scope.getSnapshot().value
      setAppearance({
        fontFamily: value?.fontFamily ?? '',
        fontSize: clampFontSize(value?.fontSize),
      })
      applyAppearanceToAll()
    }
    sync()
    return scope.subscribe(sync)
  }, 'dsh-terminal: appearance sync')

  // Follow GUI theme changes (light/dark + token edits).
  ctx.effect(() => {
    applyThemeToAll()
    return ctx.on('theme/change', () => applyThemeToAll())
  }, 'dsh-terminal: theme sync')

  // Ctrl+` toggles the panel (capture phase so it wins over xterm).
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (!event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return
      if (event.key !== '`' && event.key !== '~') return
      const enabled = scope.getSnapshot().value?.toggleKey !== false
      if (!enabled) return
      event.preventDefault()
      togglePanel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, 'dsh-terminal: panel shortcut')

  // Bottom-docked panel (host: shell.overlay, list, root scope).
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: NS,
    order: 10,
    locale: NS,
  }, () => h(TerminalDock, { t })))

  // Sidebar footer toggle button (host: sidebar.footer.action, list, root scope).
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: NS,
    locale: NS,
  }, TerminalButton))

  // Settings → Terminal section (host: settings.section, list, root scope).
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 61,
    label: () => t('nav'),
    locale: NS,
  }, () => h(TerminalSettings, { t, scope })))
}
