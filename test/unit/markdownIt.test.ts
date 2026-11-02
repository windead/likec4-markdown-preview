import MarkdownIt from 'markdown-it'
import { JSDOM } from 'jsdom'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { escapeJsonForScript } from '../../src/html'
import { likec4MarkdownIt, modelElementId } from '../../src/markdownIt'
import { resolveProject, type ProjectInfo } from '../../src/projects'
import type { HostData, HostOptions, ModelData, ProjectSnapshot, RenderDeps } from '../../src/types'

const ROOT = path.resolve('/ws')
const shop: ProjectInfo = { name: 'shop', root: path.join(ROOT, 'shop'), kind: 'json', configPath: '', serviceRoot: ROOT }
const billing: ProjectInfo = { name: 'billing', root: path.join(ROOT, 'billing'), kind: 'json', configPath: '', serviceRoot: ROOT }

function snapshot(views: string[], extra: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  const data = { views: Object.fromEntries(views.map(v => [v, { id: v, title: `</script>${v}` }])), elements: {} }
  return { hash: 'h1', state: 'ok', viewIds: new Set(views), data, modelJson: escapeJsonForScript(JSON.stringify(data)), ...extra }
}

function makeDeps(over: Partial<RenderDeps> & { snaps?: Record<string, ProjectSnapshot | undefined> } = {}) {
  const requested: string[] = []
  const refs = new Map<string, string[]>()
  const deps: RenderDeps = {
    enabled: () => true,
    maxModelBytes: () => 1024 * 1024,
    maxHeight: () => 500,
    resolve: (dir, explicit) => resolveProject(dir, explicit, [shop, billing]),
    snapshot: p => {
      requested.push(p.name)
      return (over.snaps ?? { shop: snapshot(['index', 'checkout']), billing: snapshot(['overview']) })[p.name]
    },
    recordReferences: (doc, ps) => refs.set(doc, ps.map(p => p.name)),
    ...over,
  }
  return { deps, requested, refs }
}

const env = (rel = 'shop/docs/a.md') => {
  const fsPath = path.join(ROOT, rel)
  return { currentDocument: { fsPath, toString: () => `file://${fsPath}` } }
}

function render(src: string, deps: RenderDeps, e: object = env()) {
  const md = new MarkdownIt({ html: true })
  likec4MarkdownIt(md, deps)
  return md.render(src, e)
}

function parse(html: string) {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document
  const hosts = [...doc.querySelectorAll('.likec4-view')].map(h => ({
    id: h.id,
    opts: h.getAttribute('data-likec4-opts') ? (JSON.parse(h.getAttribute('data-likec4-opts')!) as HostOptions) : null,
    data: JSON.parse(h.querySelector(':scope > script')!.textContent!) as HostData,
  }))
  const models = [...doc.querySelectorAll('.likec4-model')].map(m => ({
    id: m.id,
    data: JSON.parse(m.querySelector(':scope > script')!.textContent!) as ModelData,
  }))
  return { doc, hosts, models }
}

describe('likec4 fence rendering', () => {
  it('renders a host with options and a single model per project', () => {
    const { deps, refs } = makeDeps()
    const html = render(
      '```likec4-view browser=false dynamic-variant=sequence color-scheme=dark\ncheckout\n```\n\n```likec4-view\nindex\n```\n\n```likec4-view\nindex\n```\n',
      deps,
    )
    const { hosts, models } = parse(html)
    expect(hosts).toHaveLength(3)
    expect(models).toHaveLength(1)
    expect(models[0]!.id).toBe(modelElementId(shop))
    expect(Object.keys((models[0]!.data.model as any).views)).toEqual(['index', 'checkout'])
    expect(hosts[0]!.opts).toMatchObject({ project: 'shop', viewId: 'checkout', browser: false, variant: 'sequence', scheme: 'dark', maxHeight: 500 })
    expect(hosts[1]!.opts).toMatchObject({ viewId: 'index', browser: true, variant: 'diagram', scheme: 'auto' })
    // stable ids: occurrence counter per view
    expect(hosts.map(h => h.id.replace(/-[0-9a-f]{6}-/, '-X-'))).toEqual(['likec4-shop-X-checkout-1', 'likec4-shop-X-index-1', 'likec4-shop-X-index-2'])
    expect(hosts.every(h => h.data.state === 'ok')).toBe(true)
    expect(refs.get(`file://${path.join(ROOT, 'shop/docs/a.md')}`)).toEqual(['shop'])
  })

  it('host attributes contain options only; data changes only touch script text', () => {
    const a = parse(render('```likec4-view\nindex\n```', makeDeps().deps))
    const b = parse(render('```likec4-view\nindex\n```', makeDeps({ snaps: { shop: snapshot(['index'], { hash: 'h2' }) } }).deps))
    expect(a.hosts[0]!.id).toBe(b.hosts[0]!.id)
    expect(a.hosts[0]!.opts).toEqual(b.hosts[0]!.opts)
    expect(a.hosts[0]!.data.hash).not.toBe(b.hosts[0]!.data.hash)
  })

  it('renders error blocks without touching the model for invalid names', () => {
    const { deps, requested } = makeDeps()
    const { hosts } = parse(render('```likec4-view\n1bad\n```\n```likec4-view project=b@d\nindex\n```\n```likec4-view\n\n```', deps))
    expect(hosts.map(h => h.data.state)).toEqual(['error', 'error', 'error'])
    expect(hosts[0]!.data.message).toMatch(/Invalid view id/)
    expect(hosts[1]!.data.message).toMatch(/Invalid project name/)
    expect(hosts[2]!.data.message).toMatch(/Missing view id/)
    expect(requested).toEqual([])
  })

  it('reports unknown views, missing projects, loading and stale', () => {
    expect(parse(render('```likec4-view\nnope\n```', makeDeps().deps)).hosts[0]!.data).toMatchObject({ state: 'error' })
    expect(parse(render('```likec4-view project=zzz\nindex\n```', makeDeps().deps)).hosts[0]!.data.message).toMatch(/not found/)
    expect(parse(render('```likec4-view\nindex\n```', makeDeps({ snaps: {} }).deps)).hosts[0]!.data.state).toBe('loading')
    expect(parse(render('```likec4-view\nindex\n```', makeDeps({ resolve: () => 'pending' }).deps)).hosts[0]!.data.state).toBe('loading')
    const stale = parse(render('```likec4-view\nindex\n```', makeDeps({ snaps: { shop: snapshot(['index'], { state: 'stale', message: 'boom' }) } }).deps))
    expect(stale.hosts[0]!.data).toMatchObject({ state: 'stale', message: 'boom' })
    expect(stale.models).toHaveLength(1)
    const err = parse(render('```likec4-view\nindex\n```', makeDeps({ snaps: { shop: { hash: 'e', state: 'error', message: 'parse failed', viewIds: new Set() } } }).deps))
    expect(err.hosts[0]!.data).toMatchObject({ state: 'error', message: 'parse failed' })
    expect(err.models).toHaveLength(0)
  })

  it('no project for documents outside any project', () => {
    const { hosts } = parse(render('```likec4-view\nindex\n```', makeDeps().deps, env('docs/a.md')))
    expect(hosts[0]!.data).toMatchObject({ state: 'error' })
  })

  it('trims the model to referenced views when too large, disabling browser', () => {
    const big = snapshot(['index', 'checkout', 'other'])
    const { deps } = makeDeps({ snaps: { shop: big }, maxModelBytes: () => 10 })
    const { hosts, models } = parse(render('```likec4-view\nindex\n```', deps))
    expect(Object.keys((models[0]!.data.model as any).views)).toEqual(['index'])
    expect(models[0]!.data.trimmed).toBe(true)
    expect(hosts[0]!.data.trimmed).toBe(true)
  })

  it('embeds only referenced views when every block has browser=false', () => {
    const { hosts, models } = parse(render('```likec4-view browser=false\ncheckout\n```', makeDeps().deps))
    expect(Object.keys((models[0]!.data.model as any).views)).toEqual(['checkout'])
    expect(models[0]!.data.trimmed).toBe(false)
    expect(hosts[0]!.data.trimmed).toBeUndefined()
  })

  it('emits one model per project in multi-project documents', () => {
    const { models, hosts } = parse(render('```likec4-view\nindex\n```\n```likec4-view project=billing\noverview\n```', makeDeps().deps))
    expect(models.map(m => m.id)).toEqual([modelElementId(shop), modelElementId(billing)])
    expect(hosts.map(h => h.data.state)).toEqual(['ok', 'ok'])
  })

  it('keeps embedded data safe from </script>', () => {
    const { doc, models } = parse(render('```likec4-view\nindex\n```\n\nafter', makeDeps().deps))
    expect((models[0]!.data.model as any).views.index.title).toBe('</script>index')
    expect(doc.body.textContent).toContain('after')
  })

  it('enabled=false renders a plain code block', () => {
    const html = render('```likec4-view\nindex\n```', makeDeps({ enabled: () => false }).deps)
    expect(html).toContain('<pre><code class="language-likec4-view">index')
    expect(html).not.toContain('likec4-model')
  })
})

describe('chaining with another fence plugin', () => {
  const mermaidLike = (md: MarkdownIt) => {
    const prev = md.renderer.rules.fence!
    md.renderer.rules.fence = (tokens, idx, o, e, self) =>
      tokens[idx]!.info.trim() === 'mermaid' ? `<div class="mermaid">${tokens[idx]!.content}</div>` : prev(tokens, idx, o, e, self)
  }
  const src = '```mermaid\ngraph TD\n```\n\n```likec4-view\nindex\n```\n\n```js\nx\n```\n'

  for (const order of ['likec4 first', 'likec4 last']) {
    it(`both plugins work (${order})`, () => {
      const md = new MarkdownIt()
      if (order === 'likec4 first') {
        likec4MarkdownIt(md, makeDeps().deps)
        mermaidLike(md)
      } else {
        mermaidLike(md)
        likec4MarkdownIt(md, makeDeps().deps)
      }
      const html = md.render(src, env())
      expect(html).toContain('<div class="mermaid">graph TD')
      expect(html).toContain('class="likec4-view"')
      expect(html).toContain('<pre><code class="language-js">x')
    })
  }
})
