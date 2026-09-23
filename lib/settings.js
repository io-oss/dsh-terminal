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
/** Namespace pattern enforced by the 0.1.6 settings host. */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Settings namespace this plugin owns (0.1.7 reuses it as the Loader entry id). */
export const TERMINAL_SETTINGS_NS = 'dsh-terminal';
if (!NAMESPACE_PATTERN.test(TERMINAL_SETTINGS_NS)) {
    throw new TypeError(`settings namespace "${TERMINAL_SETTINGS_NS}" must match ${String(NAMESPACE_PATTERN)}`);
}
/** The durable terminal preferences. */
export const TerminalSettings = z.object({
    /** CSS font-family stack for xterm, or '' to follow the dsh code font. */
    fontFamily: z.string().default('').volatile(),
    /** Terminal font size in px (clamped to a sane range by the client UI). */
    fontSize: z.number().min(8).max(32).default(13).volatile(),
    /** Whether the panel shortcut is enabled at all. */
    toggleKey: z.boolean().default(true).volatile(),
    /**
     * The user-customizable panel shortcut as a canonical chord string
     * (`ctrl+shift+backquote` etc., layout-independent physical key codes).
     * Empty/unknown values disable the shortcut even when toggleKey is on.
     */
    toggleShortcut: z.string().default('ctrl+shift+backquote').volatile(),
});
/**
 * Loader Entry config of this plugin. dsh >= 0.1.7 reads exactly this export
 * (`entry.fiber.runtime.Config`) to describe and write the plugin's form, so
 * the field set must stay volatile-only.
 */
export const Config = TerminalSettings;
/** Composition defaults this plugin contributes (dsh <= 0.1.6 `base` layer). */
export const TERMINAL_SETTINGS_BASE = {
    fontFamily: '',
    fontSize: 13,
    toggleKey: true,
    toggleShortcut: 'ctrl+shift+backquote',
};
