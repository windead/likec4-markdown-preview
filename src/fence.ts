/**
 * Parsing of ```likec4-view fences, following mkdocs-likec4 1.2.x (`mkdocs_likec4/parser.py`)
 * so that a block renders here exactly when, and as, it renders in an MkDocs site.
 */

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

// Same patterns as mkdocs-likec4: searched anywhere in the options text, first match wins,
// values are case-sensitive, anything else is ignored.
const OPT_BROWSER = /\bbrowser=(true|false)\b/
const OPT_VARIANT = /\bdynamic-variant=(diagram|sequence)\b/
const OPT_PROJECT = /\bproject=(\S+)\b/
const OPT_COLOR_SCHEME = /\bcolor-scheme=(auto|light|dark)\b/

/**
 * True when the fence is a likec4-view block: opened with backticks (mkdocs-likec4 does not
 * handle `~~~` fences) and an info string starting with `likec4-view`.
 */
export function isLikeC4Fence(info: string, markup = '```'): boolean {
  if (!markup.startsWith('`')) return false
  return /^likec4-view(\s|$)/.test(info.trim())
}

/** Options text: the rest of the info string after `likec4-view`. */
function optionsText(info: string): string {
  return info.trim().slice('likec4-view'.length).trim()
}

/**
 * Parses options from the info string. `defaultScheme` is used when the block sets no valid
 * `color-scheme` (mkdocs-likec4's plugin-wide `color_scheme`). `project` is returned verbatim;
 * validate it with NAME_RE.
 */
export function parseFenceOptions(info: string, defaultScheme: ColorScheme = 'auto'): FenceOptions {
  const text = optionsText(info)
  const opts: FenceOptions = { ...DEFAULT_OPTIONS, scheme: defaultScheme }
  let m: RegExpExecArray | null
  if ((m = OPT_BROWSER.exec(text))) opts.browser = m[1] === 'true'
  if ((m = OPT_VARIANT.exec(text))) opts.variant = m[1] as DynamicVariant
  if ((m = OPT_PROJECT.exec(text))) opts.project = m[1]
  if ((m = OPT_COLOR_SCHEME.exec(text))) opts.scheme = m[1] as ColorScheme
  return opts
}

export type ViewIdResult = { ok: true; viewId: string } | { ok: false; message: string }

/**
 * The view id. Like mkdocs-likec4, the block body must be exactly one line holding the view id;
 * other bodies are not rendered by MkDocs and get an error here.
 */
export function parseViewId(content: string): ViewIdResult {
  const lines = content.replace(/\r?\n$/, '').split(/\r?\n/)
  if (lines.length !== 1) {
    return {
      ok: false,
      message: 'A likec4-view block must contain exactly one line: the view id (as required by mkdocs-likec4).',
    }
  }
  const viewId = lines[0]!.trim()
  if (!viewId) return { ok: false, message: 'Missing view id in likec4-view block.' }
  return { ok: true, viewId }
}
