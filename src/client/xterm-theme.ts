/**
 * Theme and font resolution for xterm.
 *
 * The GUI projects its design tokens as CSS custom properties on `body`
 * (`--dsw-alias-*` …) and flips dark mode with `body[data-ds-dark-theme]`.
 * Reading the computed values keeps the terminal in sync with every theme
 * change without copying palette logic here. The ANSI palette is a fixed
 * VS Code-style set that reads well on both light and dark backgrounds.
 */

import type { ITheme } from '@xterm/xterm'

/** Fallback stack when the code-font token is empty/unresolvable. */
export const MONO_FALLBACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "Cascadia Mono", monospace'

/** Read one CSS custom property from the body's computed style. */
export function readCssVar(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim()
    return value === '' || value === 'inherit' || value === 'unset' ? fallback : value
  } catch {
    return fallback
  }
}

/** Whether the GUI currently renders its dark token set. */
export function isDarkScheme(): boolean {
  try {
    return document.body.hasAttribute('data-ds-dark-theme')
  } catch {
    return true
  }
}

/** The resolved code-font stack the terminal uses by default. */
export function resolveCodeFontStack(): string {
  return readCssVar('--ds-font-family-code', MONO_FALLBACK)
}

/** Compose the xterm color theme from the live design tokens. */
export function buildTerminalTheme(): ITheme {
  const dark = isDarkScheme()
  const background = readCssVar('--dsw-alias-bg-base', dark ? '#111418' : '#ffffff')
  const foreground = readCssVar('--dsw-alias-label-primary', dark ? '#e8eaed' : '#1f2328')
  const brand = readCssVar('--dsw-alias-brand-primary', dark ? '#4c8dff' : '#2563eb')
  const selection = readCssVar('--dsw-alias-interactive-bg-hover', dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)')
  return {
    background,
    foreground,
    cursor: brand,
    cursorAccent: readCssVar('--dsw-alias-label-primary-foreground', dark ? '#111418' : '#ffffff'),
    selectionBackground: selection,
    selectionForeground: undefined,
    // VS Code default ANSI palette — legible on both schemes.
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  }
}
