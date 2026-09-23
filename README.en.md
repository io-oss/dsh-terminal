# dsh-terminal

A VS Code style integrated terminal plugin for the DeepSeek Harness Web GUI (`dsh web`).

## Features

- **Bottom panel layout (VS Code style)**: the terminal docks as a full-width strip at the bottom of the window; drag the top edge to resize, double-click the header to maximize/restore.
- **One-click toggle**: a terminal button at the bottom of the sidebar (next to Settings) opens/hides the panel; `Ctrl+Shift+\`` toggles it by default (works with DevTools open); the chord is fully customizable (or disableable) in settings.
- **Configurable fonts**: Settings → Terminal lets you pick the terminal font family (empty = follow the dsh code font) and size (10–24 px); changes apply immediately and persist.
- **Usual terminal features**:
  - Multiple tabs (new / close / switch);
  - Starts in the **current workspace directory** by default (the workspace that owns the active session; falls back to the host policy/launch directory when unresolvable);
  - Real PTY (node-pty) — vim, htop, REPLs all work;
  - Columns/rows auto-fit on panel, window and font changes (resize sent back to the PTY);
  - Copy/paste (panel buttons, `Ctrl+Shift+C` / `Ctrl+Shift+V` while the terminal is focused, or the right-click menu);
  - Clear scrollback (5000-line buffer);
  - Terminal colors follow the GUI light/dark theme; auto-reconnect with a fresh shell after a dropped connection.

## Install

Requires Node ≥ 20 (22 recommended; node-pty compiles a native addon during install).

```sh
# 1) Build inside the plugin directory
npm install
npm run build
```

```sh
# 2) Install into the web profile (run OUTSIDE the plugin dir, use an absolute path)
dsh plugin --profile web add /absolute/path/to/dsh-terminal
```

> ⚠️ The path must be the real location of the plugin project — prefer an absolute path. Running `add ./dsh-terminal` from inside the project resolves to a non-existent nested path and the plugin will not activate.
> After the install, `~/.dsh/profiles/web/package.json` should contain `"dsh-terminal": "link:…"` and `dsh.profile.bundles` should list `"dsh-terminal"` (the reconcile step appends it automatically; add it by hand if missing).

```sh
# 3) Restart dsh web, then hard-refresh the browser page
```

## Usage

| Action | Where / shortcut |
| --- | --- |
| Open / hide the terminal panel | sidebar terminal button; shortcut defaults to `Ctrl+Shift+\`` (customizable in settings) |
| New terminal | `+` in the panel header (an empty opened panel creates the first one automatically) |
| Close a tab | the `×` next to the active tab (terminates that shell) |
| Resize panel height | drag the thin strip at the top of the panel |
| Maximize / restore | double-click the panel header, or the maximize button |
| Copy / paste | header buttons; `Ctrl+Shift+C` / `Ctrl+Shift+V` inside the terminal; right-click menu |
| Clear | the trash button in the header |
| Restart an ended session | “Restart” on the bottom status banner |

Sessions keep running while the panel is hidden (like VS Code); closing a tab, refreshing the page, or dropping the connection terminates the shell.

### Settings (Settings → Terminal)

- **Font family**: presets plus a “Custom…” free-text entry for any CSS font stack; empty (default) follows the dsh code font.
- **Font size**: 10–24 px.
- **Shortcut**: defaults to `Ctrl+Shift+\``; click “Change…” to record a custom chord (needs a Ctrl/Alt/Meta modifier), restore the default, or disable shortcuts entirely.

## How it works

- **Host half (`lib/`, a Cordis plugin)**
  - registers the `dsh-terminal` settings (`fontFamily` / `fontSize` / `toggleKey` / `toggleShortcut`): through `settings.register` on dsh ≤ 0.1.6, and through the plugin's exported `Config` (the Loader-entry configuration form, whose writable fields must be `volatile`) on dsh ≥ 0.1.7;
  - registers the WebSocket upgrade route `/dsh-terminal/ws` behind a Host/Origin fence (the host `requestRejection` when available, plus its own loopback-Origin check), then performs the `ws` handshake;
  - lazily spawns one **node-pty** shell per connection (`$SHELL`, default `/bin/bash`, `TERM=xterm-256color`); output is streamed as binary frames, input as JSON frames, with `resize` support; the connection stays open after the shell exits so a tab can be restarted;
  - scrubs the environment like the host does for children (drops KEY/PASSWORD/SECRET/TOKEN and `DSH_*` vars); the start directory prefers the **workspace root the browser reports** with each `open` frame (used once verified as a real directory), falling back to `sandboxPolicy.workspaceRoot`, then `process.cwd()`;
  - heartbeats every 30 s and terminates every session on plugin teardown.
- **Browser half (`client/client.js`)**
  - mounts the bottom dock in the host `shell.overlay` slot (list, root), the toggle button in `sidebar.footer.action`, and the “Terminal” page in `settings.section`;
  - xterm.js (and its CSS) is inlined into the single-file bundle; colors read the `--dsw-alias-*` design tokens and follow `theme/change`;
  - one module-level store is shared by the dock, the button and the shortcut; tabs stay alive while the panel is hidden.

## Compatibility

One build adapts to the host at runtime. Verified:

| dsh version | Browser UI | Settings transport | Where values persist |
| --- | --- | --- | --- |
| 0.1.6-alpha.2 | ✅ | `ctx.settingsScope` (namespace registry) | the `dsh-terminal:` section of `$DSH_HOME/settings.yaml` |
| 0.1.7-alpha.1 | ✅ | `ctx.configForms` (the Loader entry's `Config`) | the `config` of the `dsh-terminal` entry in the active profile patch (e.g. `~/.dsh/profiles/web/cordis.patch.yml`) |
| 0.1.7-alpha.2 | ✅ | same | same |

The 0.1.7 host changes are absorbed inside the plugin; installing and using it is unchanged:

- the settings service moved from `settingsScope` to `configForms` (which only accepts `volatile` fields and persists into the profile patch). The browser half no longer requires `settingsScope`; it registers one binding path per service and uses whichever exists;
- the host icon set was renamed from `IconXxx16` / `IconXxx14` to `IconXxxRegular` / `IconXxxMedium`. The browser half references both generations and picks the one the host actually exports;
- upgrading 0.1.6 → 0.1.7: a `dsh-terminal:` section still present in `$DSH_HOME/settings.yaml` is imported into the profile patch on first boot. Values that only live in `settings.yaml.imported` are not read, so set them again in the settings page.

## Development

```sh
npm run typecheck              # server + client type checks
npm run build:server           # tsc → lib/
npm run build:client           # esbuild → client/client.js (xterm CSS inlined as text)
npm run build                  # both
node scripts/smoke-server.mjs                      # host-half smoke with the dsh ≤ 0.1.6 settings shape
SMOKE_SETTINGS=forms node scripts/smoke-server.mjs # same with the dsh ≥ 0.1.7 SettingsForms shape
```

After changing source, rebuild with `npm run build` and **restart `dsh web`** (both halves ship as built artifacts), then hard-refresh the browser.

## Security boundary

This terminal is a **real interactive shell on the host machine** and intentionally **bypasses** the dsh capability/approval model — the equivalent of opening a local terminal on the host. Use it only on the loopback `dsh web` instance:

- the WebSocket upgrade is fenced to same-origin/loopback requests;
- the environment handed to the shell drops secret-looking keys and `DSH_*` variables;
- it does not run inside the sandbox and is not meant for remote/shared deployments.

## Known limitations

- The bottom dock is an overlay strip (it covers the bottom of the window rather than squeezing the chat area) — true dock layout would require modifying the host layout plugin, which is out of scope.
- Sessions are rebuilt after a page refresh or a dropped connection (scrollback is lost), as with most web terminals.
- No search / web links / middle-click paste yet (easy extensions).
- Naming note: the host closure ships agent-facing headless terminal packages (`@deepseek-ai/dsh-terminal`, `dsh-terminal-bash`) that are unrelated to this unscoped `dsh-terminal` package; if the host ever adds a same-named loader entry to the web profile, change the insert id in `cordis.patch.yml`.

## License

MIT
