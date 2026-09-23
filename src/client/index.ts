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
import type { TerminalSettingsValue } from './TerminalSettings.tsx'
import { XTERM_CSS } from './xterm-css.ts'
import { setAppearance, applyAppearanceToAll, applyThemeToAll, setWorkspaceRootProvider } from './terminal.ts'
import { isShortcutCapturing, chordMatches } from './shortcut.ts'
import { togglePanel } from './store.ts'
import { createScopeHolder } from './settings-scope.ts'
import type { TerminalScope } from './settings-scope.ts'

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

/** The subset of the `settingsScope` service this plugin touches (dsh <= 0.1.6). */
interface SettingsScopeBinder {
  bind<T>(spec: { namespace: string }): TerminalScope<T>
}

/** Host face of the `settingsScope` service (dsh <= 0.1.6). */
interface SettingsScopeHost {
  settingsScope?: SettingsScopeBinder
}

/** Host face of the `configForms` service (dsh >= 0.1.7), keyed by Loader entry id. */
interface ConfigFormsHost {
  configForms?: { get<T>(entryId: string): TerminalScope<T> }
}

/** The client cordis context shape this plugin relies on. */
interface TerminalClientContext {
  effect(callback: () => unknown, label?: string): void
  on(event: string, callback: (payload?: unknown) => void): () => void
  inject(names: string[], callback: (ctx: unknown) => unknown): unknown
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-terminal'
// `settingsScope` (dsh <= 0.1.6) is deliberately NOT a required service: dsh
// 0.1.7 replaced it with `configForms`, and requiring the removed name would
// keep this plugin from activating at all there. Both transports are bound
// reactively in apply(); the package-level dsh.client.inject list still orders
// the bundle graph so the providers apply before this plugin.
export const inject = ['slots', 'locale', 'theme']

/** Clamp the persisted font size into the schema range. */
function clampFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(32, Math.max(8, value)) : 13
}

/** Loose shapes of the host session/workspace mirrors (browser-safe subset). */
interface SessionSummaryLike {
  id?: string
  cwd?: string
  blank?: boolean
  /** Local reference counts; the main view holds the Session it displays. */
  retainedBy?: { mainView?: number }
}

interface SessionListSnapshotLike {
  /** Selection mirror of dsh <= 0.1.6-alpha.1; removed in 0.1.6-alpha.2. */
  current?: string
  ids?: readonly string[]
  byId?: Record<string, SessionSummaryLike>
}

interface WorkspaceLike {
  workspaceId?: string
  path?: string
  createdAt?: string
  updatedAt?: string
  sessionIds?: readonly string[]
}

/** The `ctx.workspaces` client service face (optional for this plugin). */
interface WorkspaceServiceLike {
  list?: { getSnapshot?: () => { items?: readonly WorkspaceLike[] } | undefined }
}

interface WorkspaceHost {
  sessions?: { list?: { getSnapshot?: () => SessionListSnapshotLike | undefined } }
  /** Cordis service lookup; `workspaces` is read lazily so it stays optional. */
  get?: (name: string) => unknown
}

/**
 * Resolve the currently displayed session identity.
 *
 * dsh 0.1.6-alpha.2 dropped the `current` field from the session-list snapshot
 * (the selection now lives in the ui-session binding source), so the supported
 * signal is the main view's retain count on the row — the same lookup the
 * official layout/settings plugins perform.
 */
function currentSessionId(snapshot: SessionListSnapshotLike | undefined): string | undefined {
  if (snapshot === undefined) return undefined
  // Older hosts mirror the selection directly; keep reading it when present.
  const legacy = snapshot.current
  if (typeof legacy === 'string' && legacy !== '') return legacy
  const byId = snapshot.byId
  if (byId === undefined) return undefined
  for (const id of snapshot.ids ?? Object.keys(byId)) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

/** The optional `workspaces` mirror (`ctx.workspaces.list`), or undefined. */
function workspaceItems(host: WorkspaceHost): readonly WorkspaceLike[] | undefined {
  if (typeof host.get !== 'function') return undefined
  const service = host.get('workspaces') as WorkspaceServiceLike | undefined
  const items = service?.list?.getSnapshot?.()?.items
  return Array.isArray(items) ? items : undefined
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
    const currentId = currentSessionId(snapshot)
    if (currentId !== undefined) {
      const cwd = snapshot?.byId?.[currentId]?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    const items = workspaceItems(host)
    if (items !== undefined && items.length > 0) {
      const owned = currentId === undefined
        ? undefined
        : items.find((workspace) => workspace.sessionIds?.includes(currentId) === true)
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

  // Preferences transport. Every surface below talks to this stable holder, so
  // the UI never has to know which host generation is running:
  //   dsh >= 0.1.7 — `ctx.configForms.get('dsh-terminal')` (Loader entry Config)
  //   dsh <= 0.1.6 — `ctx.settingsScope.bind({ namespace })`
  // Exactly one of the two services exists per host, so only one callback ever
  // runs; the holder ignores a late second bind regardless.
  const scope = createScopeHolder<TerminalSettingsValue>(NS)
  ctx.inject(['configForms'], (hostCtx: unknown) => {
    const form = (hostCtx as ConfigFormsHost).configForms?.get<TerminalSettingsValue>(NS)
    return form === undefined ? () => {} : scope.bind(form)
  })
  ctx.inject(['settingsScope'], (hostCtx: unknown) => {
    const bound = (hostCtx as SettingsScopeHost).settingsScope?.bind<TerminalSettingsValue>({ namespace: NS })
    return bound === undefined ? () => {} : scope.bind(bound)
  })

  // Resolve the current workspace directory so freshly opened shells start
  // there instead of the host process cwd. `sessions` drives the lookup and is
  // therefore required; `workspaces` is read lazily through the injected
  // context so a profile without it merely loses the fallback source.
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

  // User-configurable panel shortcut (window capture so it wins over xterm and
  // the composer). The stored chord is a canonical, layout-independent string
  // (default Ctrl+Shift+`); the recorder in Settings re-binds it.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (isShortcutCapturing()) return
      const snapshot = scope.getSnapshot().value
      if (snapshot?.toggleKey === false) return
      if (!chordMatches(snapshot?.toggleShortcut, event)) return
      event.preventDefault()
      togglePanel()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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
