/**
 * The `dsh-terminal` settings namespace: the durable half of the terminal
 * preferences.
 *
 * Only two presentation fields are exposed — `fontFamily` (the terminal font
 * stack, '' = follow the dsh code font) and `fontSize` (px) — plus the
 * `toggleKey` preference for the Ctrl+` panel shortcut. The browser applies
 * the values itself; this namespace exists so the choices survive restarts
 * and show up in the settings document.
 */

import z from '@deepseek-ai/schemastery'

/** Namespace pattern enforced by the settings host. */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Settings namespace this plugin owns. */
export const TERMINAL_SETTINGS_NS = 'dsh-terminal'

if (!NAMESPACE_PATTERN.test(TERMINAL_SETTINGS_NS)) {
  throw new TypeError(`settings namespace "${TERMINAL_SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`)
}

/** The durable terminal preferences. */
export const TerminalSettings = z.object({
  /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
  fontFamily: z.string().default(''),
  /** Terminal font size in px (clamped to a sane range by the client UI). */
  fontSize: z.number().min(8).max(32).default(13),
  /** Whether the panel shortcut is enabled at all. */
  toggleKey: z.boolean().default(true),
  /**
   * The user-customizable panel shortcut as a canonical chord string
   * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
   * Empty/unknown values disable the shortcut even when toggleKey is on.
   */
  toggleShortcut: z.string().default('ctrl+shift+backquote'),
})

export type TerminalSettingsValue = Schemastery.TypeT<typeof TerminalSettings>

/** Composition defaults this plugin contributes. */
export const TERMINAL_SETTINGS_BASE: TerminalSettingsValue = {
  fontFamily: '',
  fontSize: 13,
  toggleKey: true,
  toggleShortcut: 'ctrl+shift+backquote',
}
