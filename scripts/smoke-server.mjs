/**
 * Dev smoke test for the dsh-terminal server half WITHOUT a full dsh host.
 *
 * It fakes just enough cordis ctx to run apply(): a `webServer` service whose
 * registerUpgrade hooks node:http's `upgrade` event (the same shape as
 * @deepseek-ai/dsh-host-webserver), a no-op `settings` service, and no
 * `connection`/`sandboxPolicy` (so the graceful-degradation paths run too).
 *
 * Then it drives one real WebSocket session end to end:
 *   connect → open → echo input → output received → resize → shell exit.
 *
 * Usage: node scripts/smoke-server.mjs
 */

import { createServer } from 'node:http'
import { once } from 'node:events'
import { apply } from '../lib/index.js'

const PORT = 48321

// --- minimal host fakes -------------------------------------------------
const routes = new Map() // path -> upgrade handler
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

const fakeCtx = {
  inject(names, cb) {
    const present = names.every((name) => name === 'webServer' || name === 'settings')
    if (!present) return () => {}
    const fakeHost = {
      settings: { register() {} },
      webServer: {
        registerUpgrade(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
    }
    return cb(fakeHost) ?? (() => {})
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

ws.close()
httpServer.close()
console.log('server smoke passed')
// The host half keeps a heartbeat interval alive; exit explicitly in this dev script.
process.exit(0)
