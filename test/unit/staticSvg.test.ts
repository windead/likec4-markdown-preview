import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { fromWorkspace } from '@likec4/language-services/node'
import * as path from 'node:path'
import { renderStaticSvg } from '../../src/staticSvg'

describe('renderStaticSvg', async () => {
  const likec4 = await fromWorkspace(path.resolve(__dirname, '../../fixtures'), { printErrors: false })
  const data = JSON.parse(JSON.stringify((await likec4.layoutedModel('shop')).$data))
  await likec4.dispose()

  for (const id of ['index', 'shopContainers', 'checkout', 'prodDeployment']) {
    it(`renders ${id} as well-formed SVG with all nodes and edges`, () => {
      const view = data.views[id]
      const svg = renderStaticSvg(view, 'diagram', 600)
      const doc = new JSDOM(`<body>${svg}</body>`).window.document
      const root = doc.querySelector('svg.likec4-static')!
      expect(root).toBeTruthy()
      expect(root.getAttribute('viewBox')).toMatch(/^-16 -16 /)
      const leafCount = view.nodes.filter((n: any) => !n.children?.length).length
      expect(doc.querySelectorAll('g').length).toBe(leafCount)
      expect(doc.querySelectorAll('path[stroke-width="2"]').length).toBe(view.edges.length)
      for (const n of view.nodes) expect(root.textContent).toContain(n.children?.length ? n.title.toUpperCase() : n.title.slice(0, 10))
    })
  }

  it('escapes text', () => {
    const view = structuredClone(data.views.index)
    view.nodes[0].title = '<script>x</script> & "q"'
    const svg = renderStaticSvg(view, 'diagram', 600)
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('skips the sequence variant', () => {
    expect(renderStaticSvg(data.views.checkout, 'sequence', 600)).toBe('')
  })
})
