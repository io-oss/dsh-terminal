/**
 * Ambient declarations for assets and host modules the browser bundle
 * consumes at build/runtime time but that ship no TypeScript of their own:
 *
 * - `*.css` — esbuild `text` loader turns css imports into string exports
 *   (used for embedding the xterm stylesheet into the single-file bundle).
 * - `@deepseek-ai/dsh-client-ui-primitives` — platform seed module provided
 *   by the host module table at runtime; only the members we use are typed
 *   here (deliberately minimal to stay version-tolerant).
 */

declare module '*.css' {
  const text: string
  export default text
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement } from 'react'

  export interface IconProps {
    size?: number
    className?: string
  }

  export function Tooltip(props: {
    label: string | (() => string)
    side?: 'top' | 'bottom' | 'right' | 'left'
    delayMs?: number
    disabled?: boolean
    children: ReactElement
  }): ReactElement

  export const IconPlusOutline16: (props: IconProps) => ReactElement
  export const IconCloseOutline16: (props: IconProps) => ReactElement
  export const IconChevronDownOutline14: (props: IconProps) => ReactElement
  export const IconCopyOutline16: (props: IconProps) => ReactElement
  export const IconTrashOutline16: (props: IconProps) => ReactElement
  export const IconRefreshOutline14: (props: IconProps) => ReactElement
  export const IconFullscreenOutline16: (props: IconProps) => ReactElement
  export const IconPanelLeftOutline16: (props: IconProps) => ReactElement
}
