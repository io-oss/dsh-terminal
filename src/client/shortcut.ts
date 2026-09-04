/**
 * User-customizable panel shortcut handling.
 *
 * Shortcuts are stored as a canonical chord string built from the PHYSICAL
 * key code plus modifiers, e.g. `ctrl+shift+backquote` — layout-independent,
 * so the same stored chord matches regardless of the keyboard layout or
 * whether the ` key needs Shift on that layout.
 *
 * Canonical format: `ctrl[+alt][+shift][+meta]+<key>` where `<key>` is the
 * lower-cased event.code with `Key`/`Digit` prefixes stripped, or a friendly
 * token for punctuation/named keys. Matching is exact on both modifiers and
 * key. Display ("pretty") form is produced only for the settings UI.
 */

/** Default chord: Ctrl+Shift+` (Chrome DevTools does not claim it). */
export const DEFAULT_TOGGLE_SHORTCUT = 'ctrl+shift+backquote'

/** Friendly glyphs for punctuation keys (keyed by lower-cased event.code). */
const CODE_GLYPHS: Record<string, string> = {
  backquote: '`',
  minus: '-',
  equal: '=',
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  comma: ',',
  period: '.',
  slash: '/',
  intlbackslash: '\\',
  space: 'Space',
}

/** Whether this key event is a bare modifier press (never a shortcut). */
function isModifierOnly(key: string): boolean {
  return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta'
}

/** Map an event.code to its short canonical token. */
function codeToken(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code[3]!.toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code[5]!
  return code.toLowerCase()
}

/**
 * Build the canonical chord for a keydown event, or null when the event is
 * not a valid shortcut (a bare modifier, or no Ctrl/Alt/Meta modifier).
 */
export function canonicalChordOf(event: KeyboardEvent): string | null {
  if (isModifierOnly(event.key)) return null
  const key = event.key
  const code = event.code !== '' ? event.code : key
  if (isModifierOnly(code)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  if (event.metaKey) parts.push('meta')
  if (parts.length === 0) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  return [...parts, codeToken(code)].join('+')
}

/** Pretty-print one canonical key token for the settings UI. */
function prettyToken(token: string): string {
  if (token === 'ctrl') return 'Ctrl'
  if (token === 'alt') return 'Alt'
  if (token === 'shift') return 'Shift'
  if (token === 'meta') return 'Meta'
  const glyph = CODE_GLYPHS[token]
  if (glyph !== undefined) return glyph
  if (/^[a-z]$/.test(token)) return token.toUpperCase()
  if (/^\d$/.test(token)) return token
  return token.charAt(0).toUpperCase() + token.slice(1)
}

/** Pretty-print a canonical chord ("ctrl+shift+backquote" → "Ctrl+Shift+`"). */
export function prettyChord(canonical: string | undefined): string {
  if (canonical === undefined) canonical = DEFAULT_TOGGLE_SHORTCUT
  const parts = canonical.trim().split('+').filter((part) => part !== '')
  if (parts.length < 2) return prettyToken(parts[0] ?? '')
  return parts.map(prettyToken).join('+')
}

/** Whether a keydown event matches a stored canonical chord exactly. */
export function chordMatches(canonical: string | undefined, event: KeyboardEvent): boolean {
  if (canonical === undefined || canonical.trim() === '') return false
  const actual = canonicalChordOf(event)
  return actual !== null && actual === canonical.trim().toLowerCase()
}

/**
 * Whether a shortcut recorder is active. The global panel-toggle listener
 * consults this flag so configuring a chord never toggles the panel at the
 * same time (both listeners run on window capture).
 */
let capturing = false
export function setShortcutCapturing(value: boolean): void {
  capturing = value
}
export function isShortcutCapturing(): boolean {
  return capturing
}
