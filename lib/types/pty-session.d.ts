/**
 * Local node-pty terminal-process implementation for the dsh-terminal plugin.
 *
 * Spawns one interactive shell per WebSocket session with a real PTY
 * (`name: 'xterm-256color'`), streams raw output, accepts writes and resizes.
 * Environment scrubbing mirrors the host's own rule for child processes
 * (drop KEY/PASSWORD/SECRET/TOKEN and `DSH_*` variables) so nothing
 * harness-sensitive leaks into the user's shell.
 */
/** Exit payload as node-pty reports it (numbers may be undefined). */
export interface PtyExitInfo {
    exitCode: number | undefined;
    signal: number | undefined;
}
export interface PtySessionEvents {
    onData: (chunk: Buffer) => void;
    onExit: (info: PtyExitInfo) => void;
}
/** Spawn options for one terminal session. */
export interface PtySpawnOptions {
    shell: string;
    cols: number;
    rows: number;
    cwd: string;
    env?: Record<string, string>;
}
/**
 * Build the child environment from the current process env minus secret-ish
 * and DSH-owned keys (same rule dsh uses for subprocesses), then force a real
 * color terminal so interactive programs pick the right behaviour.
 */
export declare function cleanShellEnv(source?: NodeJS.ProcessEnv): Record<string, string>;
/** Resolve the login shell: `$SHELL` when usable, else the platform default. */
export declare function resolveShell(env?: NodeJS.ProcessEnv): string;
/**
 * One PTY session. Owns the node-pty process for exactly one WebSocket
 * session and forwards the three events the wire protocol needs. All calls
 * are safe to make from the same event loop; kill() tolerates double calls.
 */
export declare class PtySession {
    private readonly proc;
    /** Start-of-session identity the client shows in the tab label. */
    readonly pid: number;
    readonly shell: string;
    readonly cwd: string;
    onData: PtySessionEvents['onData'];
    onExit: PtySessionEvents['onExit'];
    constructor(options: PtySpawnOptions);
    /** Forward one chunk of raw input bytes from the browser. */
    write(data: string): void;
    /** Resize the PTY window (cols/rows are clamped by the caller). */
    resize(cols: number, rows: number): void;
    /** Ask the shell to terminate. */
    kill(): void;
}
