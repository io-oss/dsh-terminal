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
import z from '@deepseek-ai/schemastery';
/** Settings namespace this plugin owns. */
export declare const TERMINAL_SETTINGS_NS = "dsh-terminal";
/** The durable terminal preferences. */
export declare const TerminalSettings: z<Schemastery.ObjectS<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string>;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number>;
    /** Whether Ctrl+` toggles the terminal panel. */
    toggleKey: z<boolean, boolean>;
}>, Schemastery.ObjectT<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string>;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number>;
    /** Whether Ctrl+` toggles the terminal panel. */
    toggleKey: z<boolean, boolean>;
}>>;
export type TerminalSettingsValue = Schemastery.TypeT<typeof TerminalSettings>;
/** Composition defaults this plugin contributes. */
export declare const TERMINAL_SETTINGS_BASE: TerminalSettingsValue;
