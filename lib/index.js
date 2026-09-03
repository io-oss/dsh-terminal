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
import { existsSync, statSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { TERMINAL_SETTINGS_NS, TerminalSettings, TERMINAL_SETTINGS_BASE } from './settings.js';
import { cleanShellEnv, resolveShell, PtySession } from './pty-session.js';
import { parseClientMessage } from './ws-protocol.js';
export const name = 'dsh-terminal';
export { TerminalSettings, TERMINAL_SETTINGS_NS, TERMINAL_SETTINGS_BASE } from './settings.js';
/** Path of the interactive terminal upgrade route. */
export const WS_PATH = '/dsh-terminal/ws';
/** Max concurrently open PTY sessions per plugin instance. */
export const MAX_SESSIONS = 6;
/** WebSocket close codes the plugin uses. */
const CLOSE_TOO_BIG = 1009;
const CLOSE_INTERNAL = 1011;
/** Best-effort read of the current workspace root from the sandbox policy. */
function bestEffortWorkspaceRoot(hostCtx) {
    try {
        const ctx = hostCtx;
        if (typeof ctx.get !== 'function')
            return undefined;
        const policy = ctx.get('sandboxPolicy');
        const resolve = policy?.resolve;
        if (typeof resolve !== 'function')
            return undefined;
        const result = resolve({});
        if (result === null || typeof result !== 'object')
            return undefined;
        const root = result.workspaceRoot;
        return typeof root === 'string' && root !== '' ? root : undefined;
    }
    catch {
        // sandboxPolicy is not mounted (e.g. a minimal profile) — use cwd below.
        return undefined;
    }
}
/**
 * Loopback-Origin fence (our own, independent of the host policy): reject
 * cross-site browsers while still allowing non-browser local clients.
 */
function originRejection(request) {
    const header = request.headers.origin;
    if (header === undefined || header === 'null')
        return undefined;
    let parsed;
    try {
        parsed = new URL(header);
    }
    catch {
        return 'origin header is not a valid URL';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return 'origin scheme must be http(s)';
    const hostname = parsed.hostname;
    if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '::1') {
        return `origin host is not loopback (${hostname})`;
    }
    const host = request.headers.host;
    if (typeof host === 'string' && host !== '') {
        const portMatch = /:(\d+)$/.exec(host);
        if (portMatch !== null) {
            const originPort = parsed.port === '' ? (parsed.protocol === 'https:' ? '443' : '80') : parsed.port;
            if (originPort !== portMatch[1])
                return `origin port ${originPort} does not match host ${host}`;
        }
    }
    return undefined;
}
/** Reject an upgrade before the WebSocket handshake with a plain 403. */
function rejectUpgrade(socket) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
}
/**
 * Validate a browser-supplied start directory: must be an absolute path to an
 * existing directory. Anything else yields undefined so the caller falls back
 * to its own workspace/cwd resolution.
 */
function validateStartDirectory(candidate) {
    if (candidate === undefined)
        return undefined;
    if (process.platform !== 'win32' && !candidate.startsWith('/'))
        return undefined;
    if (process.platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(candidate))
        return undefined;
    try {
        if (existsSync(candidate) && statSync(candidate).isDirectory())
            return candidate;
    }
    catch {
        // Stat failed (permissions, vanished path) — fall back.
    }
    return undefined;
}
function sendJson(ws, payload) {
    if (ws.readyState !== ws.OPEN)
        return;
    ws.send(JSON.stringify(payload));
}
/** Normalize a ws message payload to its UTF-8 text form. */
function textOfFrame(data) {
    if (typeof data === 'string')
        return data;
    if (Buffer.isBuffer(data))
        return data.toString('utf8');
    if (data instanceof ArrayBuffer)
        return Buffer.from(data).toString('utf8');
    if (Array.isArray(data)) {
        return Buffer.concat(data.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part)))).toString('utf8');
    }
    return String(data);
}
export function apply(ctx) {
    // Settings namespace: the browser applies the terminal preferences itself;
    // this half exists so the choices survive restarts and show up in the
    // settings document. register() is owned by this fiber's lifecycle.
    ctx.inject(['settings'], (hostCtx) => {
        const settings = hostCtx.settings;
        settings.register(TERMINAL_SETTINGS_NS, TerminalSettings, { base: TERMINAL_SETTINGS_BASE });
        return () => { };
    });
    // Optional host-policy fence (degrade gracefully when `connection` is gone).
    // The host method reads `this.trustedHosts`, so it must be invoked bound to
    // the host service instance — never extracted and called bare.
    let requestRejection;
    ctx.inject(['connection'], (hostCtx) => {
        const connection = hostCtx.connection;
        const rejection = connection?.requestRejection;
        if (connection !== undefined && typeof rejection === 'function') {
            const bound = rejection.bind(connection);
            requestRejection = (request) => bound(request);
            return () => { requestRejection = undefined; };
        }
        return () => { };
    });
    // The terminal WebSocket endpoint.
    ctx.inject(['webServer'], (hostCtx) => {
        try {
            const webServer = hostCtx.webServer;
            const wss = new WebSocketServer({ noServer: true });
            // Live sessions by socket; a socket starts idle and opens its PTY lazily
            // on the first { t: 'open' } frame, so merely connecting never spawns a
            // process and the shell starts in the workspace root.
            const sessions = new Map();
            const alive = new Set();
            const spawnSession = (ws, message) => {
                if (sessions.size >= MAX_SESSIONS) {
                    sendJson(ws, { t: 'error', message: `session limit reached (${String(MAX_SESSIONS)})` });
                    ws.close(CLOSE_TOO_BIG, 'session limit');
                    return;
                }
                // Browser-provided workspace root wins when it is a real directory;
                // otherwise fall back to the host policy root, then to process.cwd().
                const cwd = validateStartDirectory(message.cwd) ?? bestEffortWorkspaceRoot(hostCtx) ?? process.cwd();
                const shell = resolveShell();
                let session;
                try {
                    session = new PtySession({
                        shell,
                        cols: message.cols,
                        rows: message.rows,
                        cwd,
                        env: cleanShellEnv(),
                    });
                }
                catch (error) {
                    sendJson(ws, { t: 'error', message: `failed to start shell: ${String(error)}` });
                    ws.close(CLOSE_INTERNAL, 'spawn failed');
                    return;
                }
                sessions.set(ws, session);
                session.onData = (chunk) => {
                    if (ws.readyState === ws.OPEN)
                        ws.send(chunk, { binary: true });
                };
                session.onExit = ({ exitCode, signal }) => {
                    sessions.delete(ws);
                    sendJson(ws, { t: 'exit', code: exitCode, signal });
                };
                sendJson(ws, { t: 'ready', pid: session.pid, shell: session.shell, cwd: session.cwd });
            };
            const handleMessage = (ws, raw) => {
                const parsed = parseClientMessage(raw);
                if (!parsed.ok) {
                    ws.close(parsed.code, parsed.reason);
                    return;
                }
                const message = parsed.message;
                if (message.t === 'open') {
                    const existing = sessions.get(ws);
                    if (existing === undefined)
                        spawnSession(ws, message);
                    return;
                }
                const session = sessions.get(ws);
                if (session === undefined) {
                    // Input/resize before a successful open: ignore rather than punish —
                    // the browser always sends open first.
                    return;
                }
                if (message.t === 'input')
                    session.write(message.d);
                else if (message.t === 'resize')
                    session.resize(message.cols, message.rows);
            };
            wss.on('connection', (ws) => {
                alive.add(ws);
                ws.on('pong', () => { alive.add(ws); });
                ws.on('message', (data) => {
                    handleMessage(ws, textOfFrame(data));
                });
                ws.on('close', () => {
                    alive.delete(ws);
                    const session = sessions.get(ws);
                    if (session !== undefined) {
                        sessions.delete(ws);
                        session.kill();
                    }
                });
                ws.on('error', () => {
                    // The close handler above performs cleanup.
                });
            });
            const off = webServer.registerUpgrade({
                path: WS_PATH,
                handler: (request, socket, head) => {
                    // Own Origin check first (cheap, self-contained).
                    const own = originRejection(request);
                    if (own !== undefined && own !== null) {
                        rejectUpgrade(socket);
                        return;
                    }
                    // Host-policy fence is best-effort: the gateway only ever calls it for
                    // /api requests, and on other upgrade paths it can throw for request
                    // shapes it does not expect — never let that take the socket down.
                    let hostFence;
                    const fence = requestRejection;
                    if (fence !== undefined) {
                        try {
                            hostFence = fence(request);
                        }
                        catch (error) {
                            console.warn('[dsh-terminal] host fence threw (continuing with own check):', error);
                        }
                    }
                    if (hostFence !== undefined && hostFence !== null) {
                        rejectUpgrade(socket);
                        return;
                    }
                    try {
                        wss.handleUpgrade(request, socket, head, (ws) => {
                            wss.emit('connection', ws, request);
                        });
                    }
                    catch (error) {
                        console.warn('[dsh-terminal] upgrade handshake failed:', error);
                        socket.destroy();
                    }
                },
            });
            // Keepalive: ping every 30s; drop sockets that miss two pongs.
            const heartbeat = setInterval(() => {
                for (const ws of wss.clients) {
                    if (alive.has(ws)) {
                        alive.delete(ws);
                        try {
                            ws.ping();
                        }
                        catch {
                            // Socket went away mid-iteration; its close event cleans up.
                        }
                    }
                    else {
                        ws.terminate();
                    }
                }
            }, 30_000);
            return () => {
                clearInterval(heartbeat);
                off();
                for (const ws of wss.clients)
                    ws.terminate();
                for (const session of sessions.values())
                    session.kill();
                sessions.clear();
                wss.close();
            };
        }
        catch (error) {
            console.error('[dsh-terminal] webServer fiber error:', error);
            return () => { };
        }
    });
}
