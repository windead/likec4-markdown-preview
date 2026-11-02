/** Pure project-resolution logic (no VS Code API), shared by the extension and tests. */
import * as path from 'node:path'

export type ConfigKind = 'json' | 'script'

export const CONFIG_FILES: ReadonlyArray<{ name: string; kind: ConfigKind }> = [
  { name: 'likec4.config.json', kind: 'json' },
  { name: '.likec4rc', kind: 'json' },
  { name: 'likec4.config.js', kind: 'script' },
  { name: 'likec4.config.mjs', kind: 'script' },
  { name: 'likec4.config.ts', kind: 'script' },
  { name: 'likec4.config.mts', kind: 'script' },
]

export const DEFAULT_PROJECT = 'default'

export interface ProjectInfo {
  /** Project name (LikeC4 project id). For script configs the name is unknown: ''. */
  name: string
  /** Absolute project root (directory containing the config, or workspace root for default). */
  root: string
  kind: ConfigKind | 'default'
  /** Absolute config path ('' for default projects). */
  configPath: string
  /** Root of the LikeC4 workspace (ModelService) this project belongs to. */
  serviceRoot: string
}

export type Resolution =
  | { ok: true; project: ProjectInfo }
  | { ok: false; message: string }

/** Normalizes a path for comparisons (resolved, no trailing separator). */
export function norm(p: string): string {
  const r = path.resolve(p)
  return r.length > 1 && r.endsWith(path.sep) ? r.slice(0, -1) : r
}

/** True when `dir` equals `root` or is inside it. */
export function isWithin(dir: string, root: string): boolean {
  const d = norm(dir)
  const r = norm(root)
  return d === r || d.startsWith(r + path.sep)
}

/** Parses the project name from a JSON (or JSON5-ish .likec4rc) config text. */
export function parseConfigName(text: string): string | undefined {
  try {
    const obj = JSON.parse(stripJsonComments(text))
    return typeof obj?.name === 'string' && obj.name ? obj.name : undefined
  } catch {
    const m = /["']?name["']?\s*:\s*["']([^"']+)["']/.exec(text)
    return m?.[1]
  }
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1')
}

/**
 * Nearest project whose root is `dir` or an ancestor of it (the deepest one wins),
 * like mkdocs-likec4 `_find_nearest_project`.
 */
export function findNearestProject(dir: string, projects: ReadonlyArray<ProjectInfo>): ProjectInfo | undefined {
  let best: ProjectInfo | undefined
  for (const p of projects) {
    if (p.kind === 'default') continue
    if (isWithin(dir, p.root) && (!best || norm(p.root).length > norm(best.root).length)) best = p
  }
  return best
}

export const SCRIPT_CONFIG_MESSAGE =
  'likec4.config.js/ts is not supported by Markdown Preview for LikeC4; use likec4.config.json instead.'

/**
 * Resolves the project for a fence.
 * @param docDir directory of the markdown document (undefined when unknown)
 * @param explicit `project=` option (already validated)
 * @param projects all discovered projects (including default projects)
 */
export function resolveProject(
  docDir: string | undefined,
  explicit: string | undefined,
  projects: ReadonlyArray<ProjectInfo>,
): Resolution {
  if (explicit) {
    const matches = projects.filter(p => p.name === explicit)
    if (matches.length === 0) return { ok: false, message: `LikeC4 project "${explicit}" not found.` }
    // prefer the match nearest to the document when names repeat across roots
    const near = docDir ? findNearestProject(docDir, matches) : undefined
    return checkKind(near ?? matches[0]!)
  }
  if (docDir) {
    const near = findNearestProject(docDir, projects)
    if (near) return checkKind(near)
    const def = projects.find(p => p.kind === 'default' && isWithin(docDir, p.root))
    if (def) return { ok: true, project: def }
  } else {
    const named = projects.filter(p => p.kind !== 'default')
    if (named.length === 1) return checkKind(named[0]!)
    const defs = projects.filter(p => p.kind === 'default')
    if (named.length === 0 && defs.length === 1) return { ok: true, project: defs[0]! }
  }
  return { ok: false, message: 'No LikeC4 project found for this document.' }
}

function checkKind(p: ProjectInfo): Resolution {
  if (p.kind === 'script') return { ok: false, message: SCRIPT_CONFIG_MESSAGE }
  if (!p.name) return { ok: false, message: `LikeC4 config ${p.configPath} has no "name".` }
  return { ok: true, project: p }
}
