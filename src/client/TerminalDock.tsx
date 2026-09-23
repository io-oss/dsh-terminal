/**
 * The bottom-docked terminal panel (VS Code style), rendered inside the
 * host's `shell.overlay` slot: an absolute strip pinned to the bottom of the
 * app frame with a drag handle, a header (tabs + actions) and one xterm host
 * per terminal tab.
 *
 * The root stays mounted even when the panel is hidden (display:none) so
 * sessions survive hiding, exactly like VS Code keeps shells alive when you
 * hide the panel; only tab-close or page unload kills a PTY.
 */

import { createElement as h, useCallback, useEffect, useRef } from 'react'
import type { ReactElement, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Tooltip,
  IconPlusOutlineRegular,
  IconPlusOutline16,
  IconCloseOutlineRegular,
  IconCloseOutline16,
  IconChevronDownOutlineRegular,
  IconChevronDownOutline14,
  IconCopyOutlineRegular,
  IconCopyOutline16,
  IconTrashOutlineRegular,
  IconTrashOutline16,
  IconFullscreenOutlineRegular,
  IconFullscreenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  usePanelStore,
  getPanel,
  addSession,
  removeSession,
  setActiveSession,
  setPanelHeight,
  hidePanel,
  panelIsMaximized,
  PANEL_DEFAULT_HEIGHT,
  type SessionRecord,
} from './store.ts'
import {
  attachSession,
  detachSession,
  restartSession,
  focusSession,
  clearSession,
  copySession,
  pasteSession,
} from './terminal.ts'

/** An icon component of either naming generation (size travels in props). */
type IconComponent = (props: IconProps) => ReactElement

/**
 * Pick the icon component this host actually ships.
 *
 * dsh <= 0.1.6 named every icon after its pixel size (`IconPlusOutline16`);
 * dsh >= 0.1.7 renamed the whole set after its stroke weight
 * (`IconPlusOutlineRegular` / `…Medium`) and moved the size into props. Both
 * generations stay external in this bundle, so the one the host does not ship
 * simply reads as `undefined` here instead of failing the build.
 */
function pickIcon(primary: IconComponent | undefined, legacy: IconComponent | undefined): IconComponent {
  const picked = primary ?? legacy
  if (picked === undefined) {
    throw new Error('[dsh-terminal] host primitives ship neither icon generation')
  }
  return picked
}

const IconPlus = pickIcon(IconPlusOutlineRegular, IconPlusOutline16)
const IconClose = pickIcon(IconCloseOutlineRegular, IconCloseOutline16)
const IconChevronDown = pickIcon(IconChevronDownOutlineRegular, IconChevronDownOutline14)
const IconCopy = pickIcon(IconCopyOutlineRegular, IconCopyOutline16)
const IconTrash = pickIcon(IconTrashOutlineRegular, IconTrashOutline16)
const IconFullscreen = pickIcon(IconFullscreenOutlineRegular, IconFullscreenOutline16)

export type Translate = (key: string, params?: Record<string, unknown>) => string

interface TerminalDockProps {
  t: Translate
}

/** Small round icon button with a tooltip. */
function ActionButton(props: {
  label: string
  onClick: () => void
  children: ReactElement
  disabled?: boolean
}): ReactElement {
  const { label, onClick, children, disabled } = props
  return h(Tooltip, {
    label,
    side: 'bottom',
    delayMs: 400,
    disabled: disabled === true,
    children: h('button', {
      type: 'button',
      'aria-label': label,
      disabled,
      onClick,
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, margin: 0,
        background: 'transparent', border: 'none', borderRadius: 7,
        color: 'var(--dsw-alias-label-secondary)', cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', opacity: disabled ? 0.45 : 1,
      },
      onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (!disabled) (event.currentTarget as HTMLButtonElement).style.background = 'var(--dsw-alias-interactive-bg-hover)'
      },
      onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => {
        ;(event.currentTarget as HTMLButtonElement).style.background = 'transparent'
      },
      children,
    }),
  })
}

/** Clipboard glyph (no paste icon ships in the host primitive set). */
function PasteGlyph(): ReactElement {
  return h('svg', {
    width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    h('path', { d: 'M5.5 3.2h-1a1.4 1.4 0 0 0-1.4 1.4v7.4a1.4 1.4 0 0 0 1.4 1.4h7a1.4 1.4 0 0 0 1.4-1.4V4.6a1.4 1.4 0 0 0-1.4-1.4h-1' }),
    h('rect', { x: 5.9, y: 1.7, width: 4.2, height: 3.2, rx: 0.9 }),
    h('path', { d: 'M5.5 8.2h5M5.5 10.6h3.2' }),
  )
}

function TabButton(props: {
  record: SessionRecord
  active: boolean
  t: Translate
  onSelect: () => void
  onClose: () => void
}): ReactElement {
  const { record, active, t, onSelect, onClose } = props
  const dotColor =
    record.status === 'ready'
      ? 'var(--dsw-alias-state-success-primary)'
      : record.status === 'ended' || record.status === 'error'
        ? 'var(--dsw-alias-state-error-primary)'
        : 'var(--dsw-alias-label-tertiary)'
  return h('div', { style: { display: 'inline-flex', alignItems: 'center', flex: 'none' } },
    h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': active,
      title: record.shell !== undefined ? `${record.shell}${record.cwd !== undefined ? ` — ${record.cwd}` : ''}` : undefined,
      onClick: onSelect,
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 26, padding: '0 8px', margin: 0, boxSizing: 'border-box',
        maxWidth: 200, border: 'none', borderRadius: 7, cursor: 'pointer',
        background: active ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
        color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', fontSize: 12, lineHeight: '16px',
      },
      onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (!active) (event.currentTarget as HTMLButtonElement).style.background = 'var(--dsw-alias-interactive-bg-hover)'
      },
      onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => {
        ;(event.currentTarget as HTMLButtonElement).style.background = active
          ? 'var(--dsw-alias-interactive-bg-hover)'
          : 'transparent'
      },
      children: [
        h('span', {
          style: { flex: 'none', width: 6, height: 6, borderRadius: 3, background: dotColor },
        }),
        h('span', {
          style: { textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 },
        }, record.label !== '' ? record.label : t('session')),
      ],
    }),
    active
      ? h('span', {
          style: { display: 'inline-flex', alignItems: 'center', marginLeft: 2, flex: 'none' },
          children: ActionButton({ label: t('closeTab'), onClick: onClose, children: h(IconClose, { size: 13 }) }),
        })
      : null,
  )
}

function StatusBanner(props: { record: SessionRecord; t: Translate }): ReactElement | null {
  const { record, t } = props
  if (record.status === 'ready') return null
  const style: Record<string, string | number> = {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 12px', fontSize: 12, lineHeight: '18px',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'color-mix(in srgb, var(--dsw-alias-bg-base) 86%, transparent)',
    borderTop: '1px solid var(--dsw-alias-border-l3)',
  }
  const linkStyle: Record<string, string | number> = {
    font: 'inherit', cursor: 'pointer', color: 'var(--dsw-alias-brand-primary)',
    background: 'transparent', border: 'none', padding: '2px 4px', borderRadius: 4,
  }
  const message =
    record.status === 'connecting'
      ? t('connecting')
      : record.status === 'reconnecting'
        ? t('reconnecting')
        : record.status === 'ended'
          ? (record.error ?? t('ended'))
          : (record.error ?? t('error'))
  const actions: ReactElement[] = []
  if (record.status === 'ended' || record.status === 'error') {
    actions.push(h('button', { type: 'button', onClick: () => restartSession(record.id), style: linkStyle }, t('restart')))
  }
  return h('div', { style },
    h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, message),
    ...actions,
  )
}

function TerminalPane(props: { record: SessionRecord; t: Translate }): ReactElement {
  const { record, t } = props
  // Stable ref callback: an inline arrow would change identity on every render,
  // making React detach (null) and re-attach the session host each commit,
  // which re-connects and re-writes store state in a loop (React #185).
  const hostRef = useCallback((element: HTMLElement | null) => {
    if (element !== null) attachSession(record.id, element)
    else detachSession(record.id)
  }, [record.id])
  return h('div', {
    style: {
      position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
      padding: '4px 6px 0 8px', background: 'var(--dsw-alias-bg-base)',
    },
  },
    h('div', {
      ref: hostRef,
      style: { position: 'relative', width: '100%', height: '100%' },
    }),
    h(StatusBanner, { record, t }),
  )
}

export function TerminalDock(props: TerminalDockProps): ReactElement {
  const { t } = props
  const open = usePanelStore((state) => state.open)
  const height = usePanelStore((state) => state.height)
  const sessions = usePanelStore((state) => state.sessions)
  const activeId = usePanelStore((state) => state.activeId)
  const maximized = usePanelStore(() => panelIsMaximized())

  const dragOrigin = useRef<{ pointerY: number; height: number } | null>(null)
  const dragFrame = useRef<number | null>(null)

  // Panel stays mounted (display:none when hidden) so sessions survive hiding.
  const rootStyle: Record<string, string | number> = {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    height, boxSizing: 'border-box',
    display: open ? 'flex' : 'none',
    flexDirection: 'column',
    background: 'var(--dsw-alias-bg-layer-1)',
    borderTop: '1px solid var(--dsw-alias-border-l3)',
    boxShadow: '0 -6px 24px rgb(0 0 0 / 0.08)',
  }

  // Focus the active terminal when the panel opens or the active tab changes.
  useEffect(() => {
    if (!open || activeId === null) return undefined
    const raf = requestAnimationFrame(() => focusSession(activeId))
    return () => cancelAnimationFrame(raf)
  }, [open, activeId, sessions.length])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const strip = event.currentTarget as HTMLDivElement
    strip.setPointerCapture(event.pointerId)
    dragOrigin.current = { pointerY: event.clientY, height: getPanel().height }
    const onMove = (moveEvent: PointerEvent): void => {
      const origin = dragOrigin.current
      if (origin === null) return
      if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current)
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = null
        setPanelHeight(origin.height + (origin.pointerY - moveEvent.clientY))
      })
    }
    const onUp = (): void => {
      strip.releasePointerCapture(event.pointerId)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      dragOrigin.current = null
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  const toggleMaximize = (): void => {
    setPanelHeight(panelIsMaximized() ? PANEL_DEFAULT_HEIGHT : Math.min(520, Math.floor(window.innerHeight * 0.7)))
  }

  const handleNew = (): void => {
    const id = addSession()
    requestAnimationFrame(() => focusSession(id))
  }

  const handleCloseTab = (id: string): void => {
    detachSession(id)
    removeSession(id)
  }

  const actionsStyle: Record<string, string | number> = { display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }

  return h('div', { style: rootStyle, 'data-dsh-terminal-dock': true },
    // Top drag handle (also double-click to maximize/restore).
    h('div', {
      onPointerDown: startDrag,
      onDoubleClick: toggleMaximize,
      style: { flex: 'none', height: 6, cursor: 'ns-resize', touchAction: 'none' },
    }),
    h('div', {
      style: {
        flex: 'none', display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', minHeight: 34, boxSizing: 'border-box',
        borderBottom: '1px solid var(--dsw-alias-border-l3)',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      onDoubleClick: toggleMaximize,
    },
      h('span', {
        style: {
          flex: 'none', marginRight: 8, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap',
          color: 'var(--dsw-alias-label-secondary)',
        },
      }, t('panelTitle')),
      h('div', {
        role: 'tablist',
        style: { display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' },
      },
        sessions.map((record) =>
          h(TabButton, {
            key: record.id,
            record,
            active: record.id === activeId,
            t,
            onSelect: () => setActiveSession(record.id),
            onClose: () => handleCloseTab(record.id),
          }),
        ),
      ),
      h('div', { style: actionsStyle },
        ActionButton({ label: t('newTab'), onClick: handleNew, children: h(IconPlus, { size: 14 }) }),
        ActionButton({ label: t('copy'), onClick: () => copySession(activeId), disabled: activeId === null, children: h(IconCopy, { size: 14 }) }),
        ActionButton({ label: t('paste'), onClick: () => pasteSession(activeId), disabled: activeId === null, children: h(PasteGlyph, {}) }),
        ActionButton({ label: t('clear'), onClick: () => clearSession(activeId), disabled: activeId === null, children: h(IconTrash, { size: 14 }) }),
        h('span', { style: { width: 1, height: 16, margin: '0 3px', background: 'var(--dsw-alias-border-l3)' } }),
        ActionButton({ label: maximized ? t('restore') : t('maximize'), onClick: toggleMaximize, children: h(IconFullscreen, { size: 14 }) }),
        ActionButton({ label: t('collapse'), onClick: hidePanel, children: h(IconChevronDown, { size: 14 }) }),
      ),
    ),
    h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' } },
      sessions.length === 0
        ? h('div', {
            style: {
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, lineHeight: '20px',
            },
          },
            h('span', null, t('emptyTitle')),
            h('button', {
              type: 'button', onClick: handleNew,
              style: {
                font: 'inherit', cursor: 'pointer',
                color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
                border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 8, padding: '6px 14px',
              },
            }, t('emptyCta')),
          )
        : sessions.map((record) =>
            h('div', {
              key: record.id,
              style: { flex: 1, minHeight: 0, display: record.id === activeId ? 'flex' : 'none', flexDirection: 'column' },
            },
              h(TerminalPane, { record, t }),
            ),
          ),
    ),
  )
}
