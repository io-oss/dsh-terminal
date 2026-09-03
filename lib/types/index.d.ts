/**
 * dsh-terminal host entry: exposes one interactive-shell WebSocket endpoint
 * (`/dsh-terminal/ws`) backed by node-pty, and registers the `dsh-terminal`
 * settings namespace.
 *
 * Both halves ride scoped injection, so a host without the settings service
 * or the web server simply never runs that half — the rest keeps working.
 *
 * Security model: the endpoint is meant for the loopback Web GUI only. The
 * host runs its own Origin/Host fence (`requestRejection`) when the
 * `connection` service is present, and we add a loopback-Origin check of our
 * own as a fallback. This is a real interactive shell on the host machine —
 * it intentionally bypasses the dsh capability/permission model, exactly like
 * any terminal application.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-terminal";
export { TerminalSettings, TERMINAL_SETTINGS_NS, TERMINAL_SETTINGS_BASE } from './settings.js';
export type { PtySpawnOptions, PtyExitInfo } from './pty-session.js';
/** Path of the interactive terminal upgrade route. */
export declare const WS_PATH = "/dsh-terminal/ws";
/** Max concurrently open PTY sessions per plugin instance. */
export declare const MAX_SESSIONS = 6;
export declare function apply(ctx: Context): void;
