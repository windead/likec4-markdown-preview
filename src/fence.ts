/** Parsing of ```likec4-view fences (syntax compatible with mkdocs-likec4). */

export const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/

export type ColorScheme = 'auto' | 'light' | 'dark'
export type DynamicVariant = 'diagram' | 'sequence'

export interface FenceOptions {
  browser: boolean
  variant: DynamicVariant
  project: string | undefined
  scheme: ColorScheme
}

export const DEFAULT_OPTIONS: Readonly<FenceOptions> = Object.freeze({
  browser: true,
  variant: 'diagram',
  project: undefined,
  scheme: 'auto',
})

/** True when the info string designates a likec4-view fence. */
export function isLikeC4Fence(info: string): boolean {
  const s = info.trim()
  return s === 'likec4-view' || /^likec4-view\s/.test(s)
}

/**
 * Parses options from the info string. Unknown options and invalid values are ignored
 * (defaults apply), as in mkdocs-likec4. `project` is returned verbatim; validate with NAME_RE.
 */
export function parseFenceOptions(info: string): FenceOptions {
  const opts: FenceOptions = { ...DEFAULT_OPTIONS }
  const parts = info.trim().split(/\s+/).slice(1)
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    switch (key) {
      case 'browser':
        if (value === 'true' || value === 'false') opts.browser = value === 'true'
        break
      case 'dynamic-variant':
        if (value === 'diagram' || value === 'sequence') opts.variant = value
        break
      case 'project':
        if (value) opts.project = value
        break
      case 'color-scheme':
        if (value === 'auto' || value === 'light' || value === 'dark') opts.scheme = value
        break
    }
  }
  return opts
}

/** First non-empty line of the fence body, trimmed; '' when empty. */
export function parseViewId(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (t) return t
  }
  return ''
}
