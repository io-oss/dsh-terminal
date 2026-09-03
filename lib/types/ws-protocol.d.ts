/**
 * Wire framing for the dsh-terminal WebSocket channel.
 *
 * Browser → host: text JSON control/input frames.
 *   { t: 'open',  cols, rows }   open a fresh PTY on this socket (also re-opens
 *                                after the previous one exited — used by the
 *                                tab "restart" action)
 *   { t: 'input', d: string }    raw keystrokes / pasted text for the PTY
 *   { t: 'resize', cols, rows }  window-size change (from xterm fit)
 *
 * Host → browser:
 *   binary frame                raw PTY output bytes (written straight into xterm)
 *   text JSON events:
 *     { t: 'ready', pid, shell, cwd }      after a PTY spawn succeeded
 *     { t: 'exit', code?, signal? }        the PTY exited; socket stays open
 *     { t: 'error', message }              fatal/session-level error
 *
 * Frames are small and strictly sized on input so the parser stays trivial
 * and a flood cannot grow memory: input payload ≤ 64 KiB.
 */
/** Hard geometry bounds (xterm supports up to 500 cols / 300 rows). */
export declare const MAX_COLS = 500;
export declare const MAX_ROWS = 300;
export declare const MAX_INPUT_BYTES: number;
export interface OpenMessage {
    t: 'open';
    cols: number;
    rows: number;
    /**
     * Optional absolute directory the shell should start in. The browser sends
     * the current dsh workspace root when it can resolve one; the host still
     * validates it (exists + directory) before trusting it.
     */
    cwd?: string;
}
export interface InputMessage {
    t: 'input';
    d: string;
}
export interface ResizeMessage {
    t: 'resize';
    cols: number;
    rows: number;
}
export type ClientMessage = OpenMessage | InputMessage | ResizeMessage;
/** Result of one parse: a valid message, or a close-code + human reason. */
export type ParseResult = {
    ok: true;
    message: ClientMessage;
} | {
    ok: false;
    code: number;
    reason: string;
};
/** Clamp a requested geometry into the protocol bounds (ints only). */
export declare function clampGeometry(cols: number, rows: number): {
    cols: number;
    rows: number;
};
/** Parse a client text frame. Unknown shapes close with 1008 (policy). */
export declare function parseClientMessage(raw: unknown): ParseResult;
