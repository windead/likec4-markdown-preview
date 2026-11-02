/**
 * Static SVG snapshot of a layouted view, embedded in the host's light DOM.
 * Shown by the preview until the interactive diagram is mounted (e.g. while the preview
 * reloads after a model change), so a view never appears blank.
 */
import { defaultTheme } from '@likec4/core/styles'
import { escapeHtml } from './html'

/** Placeholder for the host id in element ids (replaced per host, ids must be unique in the page). */
export const ID_TOKEN = '__LIKEC4_HOST__'

/** Padding (diagram units) around the view bounds; keep in sync with preview/app.tsx PAD. */
export const PAD = 16
export const MIN_HEIGHT = 160

interface ElementColors { fill: string; stroke: string; hiContrast: string; loContrast: string }
interface RelColors { line: string; labelBg: string; label: string }

type Any = any

const FONT = "'IBM Plex Sans Variable','IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif"

const attr = (v: unknown) => escapeHtml(String(v ?? ''))

function colorsOf(color: string | undefined, custom: Record<string, Any> | undefined): { el: ElementColors; rel: RelColors } {
  const themed = (defaultTheme.colors as Record<string, Any>)[color ?? 'primary'] ?? custom?.[color ?? '']
  const base = (defaultTheme.colors as Record<string, Any>).primary
  return { el: themed?.elements ?? base.elements, rel: themed?.relationships ?? base.relationships }
}

function relColors(color: string | undefined, custom: Record<string, Any> | undefined): RelColors {
  const themed = (defaultTheme.colors as Record<string, Any>)[color ?? 'gray'] ?? custom?.[color ?? '']
  return themed?.relationships ?? (defaultTheme.colors as Record<string, Any>).gray.relationships
}

function text(s: unknown): string {
  if (typeof s === 'string') return s
  if (s && typeof s === 'object') return String((s as Any).txt ?? (s as Any).md ?? '')
  return ''
}

/** Greedy word wrap by estimated glyph width. */
function wrap(s: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const maxChars = Math.max(4, Math.floor(maxWidth / (fontSize * 0.56)))
  const words = s.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, Math.max(1, maxChars - 1)) + '…'
  }
  return lines.map(l => (l.length > maxChars ? l.slice(0, maxChars - 1) + '…' : l))
}

function bezierPath(points: Array<[number, number]>): string {
  if (points.length === 0) return ''
  let d = `M${points[0]![0]},${points[0]![1]}`
  let i = 1
  for (; i + 2 < points.length; i += 3) {
    const [c1, c2, p] = [points[i]!, points[i + 1]!, points[i + 2]!]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p[0]},${p[1]}`
  }
  for (; i < points.length; i++) d += ` L${points[i]![0]},${points[i]![1]}`
  return d
}

function nodeShape(n: Any, c: ElementColors): string {
  const { x, y, width: w, height: h } = n
  if (n.shape === 'storage' || n.shape === 'cylinder') {
    const ry = Math.min(18, h / 6)
    return `<path d="M${x},${y + ry} a${w / 2},${ry} 0 0,1 ${w},0 v${h - 2 * ry} a${w / 2},${ry} 0 0,1 ${-w},0 z" fill="${attr(c.fill)}" stroke="${attr(c.stroke)}"/>`
      + `<path d="M${x},${y + ry} a${w / 2},${ry} 0 0,0 ${w},0" fill="none" stroke="${attr(c.stroke)}"/>`
  }
  if (n.shape === 'queue') {
    const rx = Math.min(18, w / 6)
    return `<path d="M${x + rx},${y} h${w - 2 * rx} a${rx},${h / 2} 0 0,1 0,${h} h${-(w - 2 * rx)} a${rx},${h / 2} 0 0,1 0,${-h} z" fill="${attr(c.fill)}" stroke="${attr(c.stroke)}"/>`
  }
  const r = n.shape === 'person' ? 12 : 6
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${attr(c.fill)}" stroke="${attr(c.stroke)}"/>`
}

function leafLabel(n: Any, c: ElementColors): string {
  const cx = n.x + n.width / 2
  const maxW = n.width - 32
  const title = wrap(text(n.title), 19, maxW, 2)
  const tech = n.technology ? wrap(`[${text(n.technology)}]`, 12, maxW, 1) : []
  const desc = wrap(text(n.description), 14, maxW, 3)
  const rows: Array<{ s: string; size: number; color: string; weight: number }> = [
    ...title.map(s => ({ s, size: 19, color: c.hiContrast, weight: 500 })),
    ...tech.map(s => ({ s, size: 12, color: c.loContrast, weight: 400 })),
    ...desc.map(s => ({ s, size: 14, color: c.loContrast, weight: 400 })),
  ]
  const lineH = (r: { size: number }) => r.size * 1.25
  const total = rows.reduce((a, r) => a + lineH(r), 0) + (rows.length > title.length ? 6 : 0)
  let y = n.y + n.height / 2 - total / 2
  let out = ''
  rows.forEach((r, i) => {
    if (i === title.length && i > 0) y += 6
    y += lineH(r)
    out += `<text x="${cx}" y="${y - r.size * 0.28}" text-anchor="middle" font-size="${r.size}" font-weight="${r.weight}" fill="${attr(r.color)}">${escapeHtml(r.s)}</text>`
  })
  return out
}

function compound(n: Any, c: ElementColors): string {
  const opacity = Math.min(1, Math.max(0, (n.style?.opacity ?? 15) / 100))
  const dash = n.style?.border === 'solid' ? '' : n.style?.border === 'none' ? '' : ' stroke-dasharray="6 4"'
  const stroke = n.style?.border === 'none' ? 'none' : c.stroke
  return `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${attr(c.fill)}" fill-opacity="${opacity}" stroke="${attr(stroke)}"${dash}/>`
    + `<text x="${n.x + 14}" y="${n.y + 22}" font-size="13" font-weight="600" letter-spacing="0.4" fill="${attr(c.stroke)}">${escapeHtml(text(n.title).toUpperCase())}</text>`
}

/** Inline style of the diagram frame (same formula as the preview's interactive frame). */
export function frameStyle(bounds: { width: number; height: number }, maxHeight: number): string {
  const w = Math.ceil(bounds.width + 2 * PAD)
  const h = Math.ceil(bounds.height + 2 * PAD)
  return `display:block;width:min(100%,${w}px);aspect-ratio:${w}/${h};max-height:${maxHeight}px;min-height:${Math.min(MIN_HEIGHT, maxHeight)}px;margin:0 auto`
}

/**
 * Renders the view as an SVG string, or '' when a static rendering is not available
 * (e.g. the sequence variant of dynamic views).
 */
export function renderStaticSvg(view: Any, variant: 'diagram' | 'sequence', maxHeight: number, customColors?: Record<string, Any>): string {
  if (!view?.bounds || !Array.isArray(view.nodes)) return ''
  if (view._type === 'dynamic' && variant === 'sequence') return ''
  const b = view.bounds
  const vb = `${b.x - PAD} ${b.y - PAD} ${b.width + 2 * PAD} ${b.height + 2 * PAD}`
  let body = ''
  // compounds first (sorted by depth: parents before children)
  const nodes = [...view.nodes].sort((a: Any, z: Any) => (a.level ?? 0) - (z.level ?? 0))
  for (const n of nodes) {
    if (n.children?.length > 0) body += compound(n, colorsOf(n.color, customColors).el)
  }
  for (const n of nodes) {
    if (n.children?.length > 0) continue
    const c = colorsOf(n.color, customColors).el
    body += `<g>${nodeShape(n, c)}${leafLabel(n, c)}</g>`
  }
  let defs = ''
  const markers = new Set<string>()
  for (const e of view.edges ?? []) {
    if (!Array.isArray(e.points) || e.points.length < 2) continue
    const rc = relColors(e.color, customColors)
    const mid = `${ID_TOKEN}-m${rc.line.replace(/[^a-zA-Z0-9]/g, '')}`
    if (!markers.has(mid)) {
      markers.add(mid)
      defs += `<marker id="${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${attr(rc.line)}"/></marker>`
    }
    const dash = e.line === 'solid' ? '' : e.line === 'dotted' ? ' stroke-dasharray="2 4"' : ' stroke-dasharray="8 6"'
    const head = e.head === 'none' ? '' : ` marker-end="url(#${mid})"`
    const tail = e.tail && e.tail !== 'none' ? ` marker-start="url(#${mid})"` : ''
    let pts: Array<[number, number]> = e.points
    if (e.endpoint && head) pts = [...pts, e.endpoint]
    body += `<path d="${bezierPath(pts)}" fill="none" stroke="${attr(rc.line)}" stroke-width="2"${dash}${head}${tail}/>`
    const label = text(e.label)
    if (label && e.labelBBox) {
      const lb = e.labelBBox
      body += `<rect x="${lb.x - 2}" y="${lb.y - 1}" width="${lb.width + 4}" height="${lb.height + 2}" rx="3" fill="${attr(rc.labelBg)}" fill-opacity="0.75"/>`
        + `<text x="${lb.x + lb.width / 2}" y="${lb.y + lb.height / 2 + 4.5}" text-anchor="middle" font-size="13" fill="${attr(rc.label)}">${escapeHtml(label.split('\n')[0]!.slice(0, 80))}</text>`
    }
  }
  return `<svg class="likec4-static" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-bounds="${b.x} ${b.y} ${b.width} ${b.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(text(view.title) || String(view.id))}" style="${frameStyle(b, maxHeight)}" font-family="${escapeHtml(FONT)}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`
}
