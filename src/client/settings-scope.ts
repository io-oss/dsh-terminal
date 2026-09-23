/**
 * Version-tolerant binding of the `dsh-terminal` preferences.
 *
 * Two host generations expose the same four operations — snapshot, subscribe,
 * set, unset — under different services, so the client entry hands every
 * surface one stable holder instead of a directly bound scope:
 *
 * - dsh <= 0.1.6: `ctx.settingsScope.bind({ namespace })` from
 *   `@deepseek-ai/dsh-client-ui-settings` (namespace registry over the host
 *   settings document).
 * - dsh >= 0.1.7: `ctx.configForms.get(entryId)` from the same package,
 *   rebuilt around the Loader entry's own `Config`; the old service is gone
 *   entirely, and a plugin that still injects it never activates.
 *
 * Holding the delegation in one object keeps the UI's subscription valid
 * across the bind, and lets a host that offers neither service degrade to
 * read-only defaults instead of failing to activate.
 */

/** Sync state of one settings surface (both host generations report these). */
export type ScopeStatus = 'loading' | 'ready' | 'unavailable'

export interface TerminalScopeSnapshot<T> {
  status: ScopeStatus
  value?: T
}

/** Minimal settings-scope surface this plugin needs. */
export interface TerminalScope<T> {
  getSnapshot(): TerminalScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

/** The stable facade the UI holds; {@link TerminalScopeHolder.bind} swaps the host behind it. */
export interface TerminalScopeHolder<T> extends TerminalScope<T> {
  /**
   * Adopt one host scope.
   * @param scope - the host's bound scope.
   * @returns a disposer releasing the binding if it is still the active one.
   */
  bind(scope: TerminalScope<T>): () => void
}

/** Snapshot served before any host scope is bound (and by a host offering none). */
const PENDING: TerminalScopeSnapshot<never> = { status: 'loading' }

/**
 * Create a holder that forwards to the first host scope bound to it.
 *
 * @param label - diagnostic prefix for dropped writes.
 * @returns the stable scope facade.
 */
export function createScopeHolder<T>(label: string): TerminalScopeHolder<T> {
  let current: TerminalScope<T> | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    bind(scope) {
      // Only one host generation ever offers a scope; ignoring a second bind
      // keeps a future host that exposes both from double-writing.
      if (current !== undefined) return () => {}
      current = scope
      notify()
      return () => {
        if (current !== scope) return
        current = undefined
        notify()
      }
    },
    getSnapshot() {
      return current?.getSnapshot() ?? (PENDING as TerminalScopeSnapshot<T>)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(field, value) {
      const scope = current
      if (scope === undefined) {
        console.warn(`[dsh-terminal] ${label}: no settings service mounted; dropped "${field}"`)
        return Promise.resolve(false)
      }
      return scope.set(field, value)
    },
    unset(field) {
      const scope = current
      if (scope === undefined) return Promise.resolve(false)
      return scope.unset(field)
    },
  }
}
