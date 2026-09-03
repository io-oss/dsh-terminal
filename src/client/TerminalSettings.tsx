/**
 * "Terminal" settings section: terminal font family, font size and the
 * Ctrl+` panel shortcut, persisted through the `dsh-terminal` settings scope.
 * Every change is applied live by the plugin entry's subscription, so an open
 * terminal picks it up immediately.
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement, ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

export type Translate = (key: string, params?: Record<string, unknown>) => string

/** Minimal settings-scope surface this section needs (host: dsh-client-ui-settings). */
export interface TerminalScope<T> {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value?: T }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

export interface TerminalSettingsValue {
  fontFamily: string
  fontSize: number
  toggleKey: boolean
}

interface TerminalSettingsProps {
  t: Translate
  scope: TerminalScope<TerminalSettingsValue>
}

const PRESET_FONTS = [
  'DejaVu Sans Mono',
  'JetBrains Mono',
  'Cascadia Mono',
  'Fira Code',
  'SF Mono',
  'Consolas',
  'Menlo',
  'monospace',
]

const FONT_SIZES = Array.from({ length: 15 }, (_, index) => index + 10)

function currentValue(scope: TerminalScope<TerminalSettingsValue>): TerminalSettingsValue {
  const value = scope.getSnapshot().value
  return {
    fontFamily: value?.fontFamily ?? '',
    fontSize: typeof value?.fontSize === 'number' && Number.isFinite(value.fontSize) ? value.fontSize : 13,
    toggleKey: value?.toggleKey !== false,
  }
}

export function TerminalSettings(props: TerminalSettingsProps): ReactElement {
  const { t, scope } = props
  const [settings, setSettings] = useState<TerminalSettingsValue>(() => currentValue(scope))
  const [ready, setReady] = useState(scope.getSnapshot().status)
  const [customText, setCustomText] = useState('')

  useEffect(() => {
    const sync = () => {
      const snapshot = scope.getSnapshot()
      setReady(snapshot.status)
      setSettings(currentValue(scope))
    }
    sync()
    return scope.subscribe(sync)
  }, [scope])

  const rowStyle: Record<string, string | number> = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }
  const labelBoxStyle: Record<string, string | number> = { display: 'flex', flexDirection: 'column', flex: '1', gap: 3, minWidth: 0 }
  const labelStyle: Record<string, string | number> = { fontSize: 13, lineHeight: '20px' }
  const hintStyle: Record<string, string | number> = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px' }
  const controlStyle: Record<string, string | number> = {
    boxSizing: 'border-box', minWidth: 220, maxWidth: '46%',
    color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)',
    border: '1px solid var(--dsw-alias-border-l3)', borderRadius: 8,
    padding: '6px 10px', fontSize: 13, lineHeight: '20px', fontFamily: 'inherit',
  }
  const resetStyle: Record<string, string | number> = {
    font: 'inherit', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l3)',
    borderRadius: 7, padding: '5px 12px', fontSize: 12, lineHeight: '18px',
  }
  const previewStyle: Record<string, string | number> = {
    border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)',
    borderRadius: 10, padding: '12px 16px', marginTop: 4,
  }
  const previewCodeStyle: Record<string, string | number> = {
    margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
    fontFamily: settings.fontFamily !== ''
      ? `${settings.fontFamily}, monospace`
      : 'var(--ds-font-family-code, monospace)',
    fontSize: `${settings.fontSize}px`,
    lineHeight: `${settings.fontSize + 6}px`,
    color: 'var(--dsw-alias-label-primary)',
  }

  const selectFont = (value: string): void => {
    setSettings((previous) => ({ ...previous, fontFamily: value }))
    void scope.set('fontFamily', value)
  }
  const commitCustomFont = (): void => {
    const text = customText.trim()
    if (text !== '') {
      setSettings((previous) => ({ ...previous, fontFamily: text }))
      void scope.set('fontFamily', text)
    }
  }
  const selectSize = (event: ChangeEvent<HTMLSelectElement>): void => {
    const size = Number(event.target.value)
    setSettings((previous) => ({ ...previous, fontSize: size }))
    void scope.set('fontSize', size)
  }
  const toggleShortcut = (): void => {
    const next = !settings.toggleKey
    setSettings((previous) => ({ ...previous, toggleKey: next }))
    void scope.set('toggleKey', next)
  }
  const resetAll = (): void => {
    setSettings({ fontFamily: '', fontSize: 13, toggleKey: true })
    void scope.unset('fontFamily')
    void scope.unset('fontSize')
    void scope.unset('toggleKey')
  }

  const isPreset = settings.fontFamily === '' || PRESET_FONTS.includes(settings.fontFamily)
  const selectValue = isPreset ? settings.fontFamily : '__custom__'
  const disabled = ready !== 'ready'

  const fontOptions = PRESET_FONTS.map((family) => h('option', { key: family, value: family }, family))

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: '18px', margin: '0 0 8px' } }, t('settingsDesc')),

    h('div', { style: rowStyle },
      h('div', { style: labelBoxStyle },
        h('span', { style: labelStyle }, t('fontFamilyTitle')),
        h('span', { style: hintStyle }, t('fontFamilyHint')),
      ),
      disabled
        ? h('span', { style: hintStyle }, '…')
        : h('select', {
            value: selectValue,
            disabled,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value
              if (value === '__custom__') {
                setCustomText(settings.fontFamily)
                return
              }
              selectFont(value)
            },
            style: controlStyle,
          },
            h('option', { value: '' }, t('defaultOption')),
            h('optgroup', { label: t('presetMonospace') }, fontOptions),
            h('option', { value: '__custom__' }, t('customOption')),
          ),
    ),

    !isPreset || customText !== '' || selectValue === '__custom__'
      ? h('div', { style: { ...rowStyle, paddingTop: 0 } },
          h('div', { style: labelBoxStyle },
            h('span', { style: hintStyle }, t('customOption')),
          ),
          h('input', {
            type: 'text',
            value: isPreset ? customText : settings.fontFamily,
            placeholder: t('customFontFamilyPlaceholder'),
            disabled,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              setCustomText(event.target.value)
              setSettings((previous) => ({ ...previous, fontFamily: event.target.value }))
            },
            onBlur: commitCustomFont,
            onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur()
            },
            style: { ...controlStyle, fontFamily: 'var(--ds-font-family-code, monospace)' },
          }),
        )
      : null,

    h('div', { style: rowStyle },
      h('div', { style: labelBoxStyle },
        h('span', { style: labelStyle }, t('fontSizeTitle')),
        h('span', { style: hintStyle }, t('fontSizeHint')),
      ),
      h('select', {
        value: String(settings.fontSize),
        disabled,
        onChange: selectSize,
        style: { ...controlStyle, minWidth: 96, width: 96 },
      }, FONT_SIZES.map((size) => h('option', { key: size, value: String(size) }, `${size}px`))),
    ),

    h('div', { style: rowStyle },
      h('div', { style: labelBoxStyle },
        h('span', { style: labelStyle }, t('toggleKeyTitle')),
        h('span', { style: hintStyle }, t('toggleKeyHint')),
      ),
      h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': settings.toggleKey,
        disabled,
        onClick: toggleShortcut,
        style: {
          display: 'inline-flex', alignItems: 'center', cursor: disabled ? 'default' : 'pointer',
          width: 36, height: 20, padding: 2, boxSizing: 'border-box', border: 'none', borderRadius: 10,
          background: settings.toggleKey ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l3)',
          opacity: disabled ? 0.5 : 1,
        },
        children: h('span', {
          style: {
            display: 'block', width: 16, height: 16, borderRadius: 8,
            background: 'var(--dsw-alias-label-primary-foreground, #fff)',
            transform: settings.toggleKey ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform .12s var(--ds-ease-in-out)',
          },
        }),
      }),
    ),

    h('div', { style: previewStyle },
      h('pre', { style: previewCodeStyle }, 'ls -la ~/projects && git status # dsh-terminal'),
    ),

    h('div', { style: rowStyle },
      h('div', { style: labelBoxStyle },
        h('span', { style: labelStyle }, t('resetHint')),
      ),
      h('button', { type: 'button', onClick: resetAll, style: resetStyle }, t('reset')),
    ),
  )
}
