// @vitest-environment jsdom
import MarkdownIt from 'markdown-it'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HostManager, type RootLike } from '../../preview/hosts'
import { escapeJsonForScript } from '../../src/html'
import { likec4MarkdownIt } from '../../src/markdownIt'
import { resolveProject, type ProjectInfo } from '../../src/projects'
import type { ProjectSnapshot, RenderDeps } from '../../src/types'
import { initialLoad, updateContent } from './vscodePreviewMorph'

const ROOT = path.resolve('/ws')
const shop: ProjectInfo = { name: 'shop', root: path.join(ROOT, 'shop'), kind: 'json', configPath: '', serviceRoot: ROOT }

function snap(hash: string, title = 'Customer'): ProjectSnapshot {
  const data = { views: { index: { id: 'index', title }, checkout: { id: 'checkout' } } }
  return { hash, state: 'ok', viewIds: new Set(['index', 'checkout']), data, modelJson: escapeJsonForScript(JSON.stringify(data)) }
}

function renderer(get: () => ProjectSnapshot | undefined) {
  const deps: RenderDeps = {
    enabled: () => true,
    maxModelBytes: () => 1 << 20,
    maxHeight: () => 600,
    resolve: (d, e) => resolveProject(d, e, [shop]),
    snapshot: () => get(),
    recordReferences: () => {},
  }
  const md = new MarkdownIt({ html: true })
  likec4MarkdownIt(md, deps)
  const env = () => ({ currentDocument: { fsPath: path.join(ROOT, 'shop/a.md'), toString: () => 'file:///ws/shop/a.md' } })
  return (src: string) => md.render(src, env())
}

const listeners: Array<() => void> = []

function setup() {
  document.body.innerHTML = '<div class="markdown-body"></div>'
  const doc = document
  const dom = { window }
  const created: Array<{ container: Element; renders: unknown[]; unmounted: boolean }> = []
  const manager = new HostManager<{ hash: string }>(doc, {
    createRoot: container => {
      const rec = { container, renders: [] as unknown[], unmounted: false }
      created.push(rec)
      const root: RootLike = { render: n => rec.renders.push(n), unmount: () => (rec.unmounted = true) }
      return root
    },
    model: id => {
      const el = doc.getElementById(id)?.querySelector(':scope > script')
      return el ? { hash: JSON.parse(el.textContent!).hash } : null
    },
    view: input => ({ hostId: input.hostId, data: input.data, modelHash: input.model?.hash }),
  })
  const onUpdate = () => manager.scan()
  listeners.forEach(l => window.removeEventListener('vscode.markdown.updateContent', l))
  listeners.length = 0
  listeners.push(onUpdate)
  dom.window.addEventListener('vscode.markdown.updateContent', onUpdate)
  return { doc, manager, created }
}

const DOC = (extra = '') => `# Title\n\n${extra}Intro\n\n\`\`\`likec4-view\nindex\n\`\`\`\n\n\`\`\`likec4-view\nindex\n\`\`\`\n\n\`\`\`likec4-view browser=false\ncheckout\n\`\`\`\n`

describe('preview host lifecycle under VS Code morphdom updates', () => {
  it('only JSON changes: hosts and shadow roots are kept, roots not recreated, re-rendered', () => {
    let s = snap('h1')
    const render = renderer(() => s)
    const { doc, manager, created } = setup()
    initialLoad(doc, render(DOC()))
    manager.scan()
    const hosts = [...doc.querySelectorAll('.likec4-view')]
    const shadows = hosts.map(h => h.shadowRoot)
    expect(created).toHaveLength(3)
    expect(manager.renders).toBe(3)

    s = snap('h2', 'Buyer')
    updateContent(doc, render(DOC()))
    const after = [...doc.querySelectorAll('.likec4-view')]
    expect(after).toEqual(hosts)
    expect(after.map(h => h.shadowRoot)).toEqual(shadows)
    expect(created).toHaveLength(3)
    expect(created.every(c => !c.unmounted)).toBe(true)
    expect(manager.renders).toBe(6)
    expect((created[0]!.renders.at(-1) as any).modelHash).toBe('h2')
  })

  it('other markdown changes do not touch hosts (no re-render)', () => {
    const s = snap('h1')
    const render = renderer(() => s)
    const { doc, manager, created } = setup()
    initialLoad(doc, render(DOC()))
    manager.scan()
    const hosts = [...doc.querySelectorAll('.likec4-view')]
    const scripts = hosts.map(h => h.querySelector('script'))
    updateContent(doc, render(DOC('New paragraph before.\n\n')))
    expect([...doc.querySelectorAll('.likec4-view')]).toEqual(hosts)
    expect(hosts.map(h => h.querySelector('script'))).toEqual(scripts)
    expect(manager.renders).toBe(3)
    expect(created).toHaveLength(3)
    expect(doc.body.textContent).toContain('New paragraph before.')
  })

  it('same hash is skipped', () => {
    const s = snap('h1')
    const render = renderer(() => s)
    const { doc, manager } = setup()
    initialLoad(doc, render(DOC()))
    manager.scan()
    manager.scan()
    updateContent(doc, render(DOC()))
    expect(manager.renders).toBe(3)
  })

  it('removed hosts are unmounted; repeated references are independent', () => {
    let s = snap('h1')
    const render = renderer(() => s)
    const { doc, manager, created } = setup()
    initialLoad(doc, render(DOC()))
    manager.scan()
    const [first, second] = [...doc.querySelectorAll('.likec4-view')]
    expect(first!.id).not.toBe(second!.id)
    // remove the second `index` block
    updateContent(doc, render('# Title\n\nIntro\n\n```likec4-view\nindex\n```\n\n```likec4-view browser=false\ncheckout\n```\n'))
    expect(doc.querySelectorAll('.likec4-view')).toHaveLength(2)
    expect(doc.querySelector('.likec4-view')).toBe(first)
    expect(created.filter(c => c.unmounted)).toHaveLength(1)
    expect(manager.entries.size).toBe(2)
    s = snap('h3')
    updateContent(doc, render('# Title\n\nIntro\n\n```likec4-view\nindex\n```\n\n```likec4-view browser=false\ncheckout\n```\n'))
    expect(manager.entries.size).toBe(2)
  })

  it('model element keeps its id after domEval re-creates scripts', () => {
    const s = snap('h1')
    const render = renderer(() => s)
    const { doc } = setup()
    initialLoad(doc, render(DOC()))
    const model = doc.querySelector('.likec4-model')!
    expect(model.id).toMatch(/^likec4-model-shop-/)
    expect(JSON.parse(model.querySelector('script')!.textContent!).hash).toBe('h1')
  })
})
