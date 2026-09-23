/**
 * The `dsh-terminal` settings surface: the durable half of the terminal
 * preferences.
 *
 * Only two presentation fields are exposed — `fontFamily` (the terminal font
 * stack, '' = follow the dsh code font) and `fontSize` (px) — plus the
 * `toggleKey` preference for the Ctrl+` panel shortcut. The browser applies
 * the values itself; this schema exists so the choices survive restarts.
 *
 * Two host generations consume it, and the same four fields serve both:
 *
 * - dsh <= 0.1.6: the namespace registry of the `settings` service
 *   (`dsh-settings-file`), registered from `index.ts` with
 *   {@link TERMINAL_SETTINGS_BASE} as the composition layer; the document is
 *   `$DSH_HOME/settings.yaml`.
 * - dsh >= 0.1.7: the Loader entry's own `Config` (`SettingsForms`), whose
 *   `volatile` fields are the only ones a configuration form may write; the
 *   values persist in the active profile's patch file.
 *
 * `.volatile()` (schemastery >= 3.18.3) is therefore required, and it must be
 * chained *after* `.default()` so each field stays defined.
 */
import z from '@deepseek-ai/schemastery';
/** Settings namespace this plugin owns (0.1.7 reuses it as the Loader entry id). */
export declare const TERMINAL_SETTINGS_NS = "dsh-terminal";
/** The durable terminal preferences. */
export declare const TerminalSettings: z<Schemastery.ObjectS<NoInfer<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string, "volatile-defined">;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number, "volatile-defined">;
    /** Whether the panel shortcut is enabled at all. */
    toggleKey: z<boolean, boolean, "volatile-defined">;
    /**
     * The user-customizable panel shortcut as a canonical chord string
     * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
     * Empty/unknown values disable the shortcut even when toggleKey is on.
     */
    toggleShortcut: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string, "volatile-defined">;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number, "volatile-defined">;
    /** Whether the panel shortcut is enabled at all. */
    toggleKey: z<boolean, boolean, "volatile-defined">;
    /**
     * The user-customizable panel shortcut as a canonical chord string
     * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
     * Empty/unknown values disable the shortcut even when toggleKey is on.
     */
    toggleShortcut: z<string, string, "volatile-defined">;
}>>, "plain">;
/**
 * Loader Entry config of this plugin. dsh >= 0.1.7 reads exactly this export
 * (`entry.fiber.runtime.Config`) to describe and write the plugin's form, so
 * the field set must stay volatile-only.
 */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string, "volatile-defined">;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number, "volatile-defined">;
    /** Whether the panel shortcut is enabled at all. */
    toggleKey: z<boolean, boolean, "volatile-defined">;
    /**
     * The user-customizable panel shortcut as a canonical chord string
     * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
     * Empty/unknown values disable the shortcut even when toggleKey is on.
     */
    toggleShortcut: z<string, string, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z<string, string, "volatile-defined">;
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z<number, number, "volatile-defined">;
    /** Whether the panel shortcut is enabled at all. */
    toggleKey: z<boolean, boolean, "volatile-defined">;
    /**
     * The user-customizable panel shortcut as a canonical chord string
     * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
     * Empty/unknown values disable the shortcut even when toggleKey is on.
     */
    toggleShortcut: z<string, string, "volatile-defined">;
}>>, "plain">;
/** Plain (unwrapped) shape of {@link TerminalSettings}. */
export interface TerminalSettingsValue {
    fontFamily: string;
    fontSize: number;
    toggleKey: boolean;
    toggleShortcut: string;
}
/** Composition defaults this plugin contributes (dsh <= 0.1.6 `base` layer). */
export declare const TERMINAL_SETTINGS_BASE: TerminalSettingsValue;
