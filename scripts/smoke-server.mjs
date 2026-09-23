/**
 * Dev smoke test for the dsh-terminal server half WITHOUT a full dsh host.
 *
 * It fakes just enough cordis ctx to run apply(): a `webServer` service whose
 * registerUpgrade hooks node:http's `upgrade` event (the same shape as
 * @deepseek-ai/dsh-host-webserver), a `settings` service, and no
 * `connection`/`sandboxPolicy` (so the graceful-degradation paths run too).
 *
 * `settings` is faked in both host generations, selected by SMOKE_SETTINGS:
 *
 *   register (default) — dsh <= 0.1.6: the namespace registry that exposes
 *                        `register(ns, schema, { base })`.
 *   forms              — dsh >= 0.1.7: `SettingsForms`, which exposes NO
 *                        `register`; persistence rides the entry's own
 *                        exported `Config`, so apply() must simply skip it.
 *
 * Then it drives one real WebSocket session end to end:
 *   connect → open → echo input → output received → resize → shell exit.
 *
 * Usage: SMOKE_SETTINGS=forms node scripts/smoke-server.mjs
 */

import { createServer } from 'node:http'
import { once } from 'node:events'
import { apply } from '../lib/index.js'

const PORT = Number(process.env.SMOKE_PORT ?? 48321)
const SETTINGS_SHAPE = process.env.SMOKE_SETTINGS ?? 'register'
if (SETTINGS_SHAPE !== 'register' && SETTINGS_SHAPE !== 'forms') {
  throw new Error(`SMOKE_SETTINGS must be "register" or "forms", got ${SETTINGS_SHAPE}`)
}

// --- minimal host fakes -------------------------------------------------
const routes = new Map() // path -> upgrade handler
/** Namespaces the 0.1.6-style registry accepted. */
const registered = []
/** dsh >= 0.1.7 `SettingsForms`: describe/update/replace/mutate, never register. */
const formsService = {
  describe: () => [],
  update: async () => {},
  replace: async () => {},
  mutate: async () => {},
}

const httpServer = createServer((_req, res) => {
  res.writeHead(404).end()
})
httpServer.on('upgrade', (req, socket, head) => {
  const handler = routes.get(new URL(req.url ?? '/', 'http://x').pathname)
  if (handler === undefined) {
    socket.destroy()
    return
  }
  Promise.resolve(handler(req, socket, head)).catch((error) => {
    console.error('upgrade handler error', error)
    socket.destroy()
  })
})

const settingsService = SETTINGS_SHAPE === 'register'
  ? { register(ns, _schema, options) { registered.push({ ns, base: options?.base }) } }
  : formsService

const fakeCtx = {
  inject(names, cb) {
    const present = names.every((name) => name === 'webServer' || name === 'settings')
    if (!present) return () => {}
    const fakeHost = {
      settings: settingsService,
      webServer: {
        registerUpgrade(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
    }
    const disposer = cb(fakeHost)
    return disposer ?? (() => {})
  },
  get() {
    throw new Error('sandboxPolicy not mounted in smoke host')
  },
}

apply(fakeCtx)
await new Promise((resolve) => httpServer.listen(PORT, '127.0.0.1', resolve))
console.log('server listening on', PORT)

// --- real WebSocket client ---------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/dsh-terminal/ws`)

let received = ''
let readyCwd = null
let exitInfo = null
let resolveExit
const exited = new Promise((resolve) => { resolveExit = resolve })

ws.addEventListener('message', async (event) => {
  if (typeof event.data === 'string') {
    const parsed = JSON.parse(event.data)
    if (parsed.t === 'ready') readyCwd = parsed.cwd ?? null
    if (parsed.t === 'exit') {
      exitInfo = parsed
      resolveExit(parsed)
    }
    if (parsed.t === 'error') console.error('server error frame:', parsed)
    return
  }
  // binary = raw pty output
  const text = Buffer.from(await event.data.arrayBuffer()).toString('utf8')
  received += text
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', (event) => reject(new Error(`ws connect error: ${event.message ?? ''}`)), { once: true })
})
console.log('ws connected')
ws.send(JSON.stringify({ t: 'open', cols: 90, rows: 28, cwd: '/tmp' }))

const marker = `SMOKE_${Date.now().toString(36)}`
ws.send(JSON.stringify({ t: 'input', d: `printf '${marker}\\n'; pwd; exit\n` }))

await Promise.race([
  exited,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for pty exit')), 10_000)),
])
ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 30 }))
await new Promise((resolve) => setTimeout(resolve, 150))

if (readyCwd !== '/tmp') throw new Error(`browser-supplied cwd not honoured: ${JSON.stringify(readyCwd)}`)
if (exitInfo === null) throw new Error('never received exit frame')
if (!received.includes(marker)) throw new Error(`pty output missing marker; got ${JSON.stringify(received.slice(-200))}`)
if (!received.includes('/tmp')) throw new Error(`pty did not run in /tmp; got ${JSON.stringify(received.slice(-200))}`)
console.log('ok: ready + echo output + cwd honoured + exit received')

if (SETTINGS_SHAPE === 'register') {
  const entry = registered.find((row) => row.ns === 'dsh-terminal')
  if (entry === undefined) throw new Error(`0.1.6 settings registry was not called: ${JSON.stringify(registered)}`)
  if (entry.base?.toggleShortcut !== 'ctrl+shift+backquote') {
    throw new Error(`0.1.6 base layer missing: ${JSON.stringify(entry.base)}`)
  }
  console.log('ok: 0.1.6 settings.register path (namespace + base layer)')
} else {
  if (registered.length !== 0) throw new Error('0.1.7 settings face must not be written through a registry')
  console.log('ok: 0.1.7 SettingsForms path (register skipped, endpoint intact)')
}

ws.close()
httpServer.close()
console.log(`server smoke passed (SMOKE_SETTINGS=${SETTINGS_SHAPE})`)
// The host half keeps a heartbeat interval alive; exit explicitly in this dev script.
process.exit(0)
