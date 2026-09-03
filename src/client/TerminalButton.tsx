/**
 * Sidebar footer action: the one-click terminal toggle (rail icon when the
 * sidebar is collapsed, icon + label when wide). Registered into the host's
 * `sidebar.footer.action` list slot next to the settings control.
 */

import { createElement as h } from 'react'
import type { ReactElement, MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { usePanelStore, togglePanel } from './store.ts'

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface TerminalButtonProps {
  wide: boolean
  t: Translate
}

/** Terminal glyph ("›_" style) — no terminal icon ships in the host set. */
export function TerminalGlyph(props: { size?: number }): ReactElement {
  const size = props.size ?? 16
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  },
    h('path', { d: 'M2 4.5 6.2 8 2 11.5' }),
    h('path', { d: 'M7.2 11.8h6.6' }),
    h('rect', { x: 1.2, y: 1.6, width: 13.6, height: 12.8, rx: 1.6, opacity: 0.45 }),
  )
}

export function TerminalButton(props: TerminalButtonProps): ReactElement {
  const { wide, t } = props
  const open = usePanelStore((state) => state.open)
  const running = usePanelStore((state) => state.sessions.length > 0)
  const label = open ? t('hide') : t('open')

  const button = h('button', {
    type: 'button',
    'aria-label': label,
    'aria-pressed': open,
    onClick: () => togglePanel(),
    style: {
      flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: wide ? 'flex-start' : 'center', gap: 8,
      width: wide ? '100%' : 36, height: 36, boxSizing: 'border-box',
      margin: wide ? '2px 0' : 0, padding: wide ? '0 10px 0 8px' : 0,
      background: open ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
      border: 'none', borderRadius: 12,
      color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontFamily: 'inherit',
      fontSize: 14, lineHeight: '20px', position: 'relative',
    },
    onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => {
      ;(event.currentTarget as HTMLButtonElement).style.background = open
        ? 'var(--dsw-alias-interactive-bg-hover)'
        : 'var(--dsw-alias-interactive-bg-hover)'
    },
    onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => {
      ;(event.currentTarget as HTMLButtonElement).style.background = open ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent'
    },
    children: [
      h('span', { style: { display: 'inline-flex', flex: 'none', color: open ? 'var(--dsw-alias-brand-primary)' : 'inherit' } },
        h(TerminalGlyph, { size: wide ? 16 : 18 }),
      ),
      wide ? h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' } }, label) : null,
      // Dot: a hidden-but-running session exists.
      !open && running
        ? h('span', {
            style: {
              position: 'absolute', top: 6, right: wide ? 8 : 7,
              width: 5, height: 5, borderRadius: 3,
              background: 'var(--dsw-alias-brand-primary)',
            },
          })
        : null,
    ],
  })

  if (wide) return h('div', { style: { width: '100%', display: 'flex' } }, button)
  return h(Tooltip, {
    label,
    side: 'right',
    delayMs: 500,
    children: h('div', { style: { display: 'flex', justifyContent: 'center' } }, button),
  })
}
