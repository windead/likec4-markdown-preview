import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { jsonForScript } from '../../src/html'

describe('jsonForScript', () => {
  const nasty = {
    title: '</script><script>alert(1)</script>',
    description: '<!-- comment --> & </SCRIPT > \u2028line\u2029para',
    nested: { list: ['<b>', '&amp;'] },
  }

  it('produces no raw <, >, & or line separators', () => {
    const s = jsonForScript(nasty)
    expect(s).not.toMatch(/[<>&\u2028\u2029]/)
  })

  it('keeps the HTML structure intact and round-trips', () => {
    const html = `<div id="host"><script type="application/json">${jsonForScript(nasty)}</script></div><p id="after">after</p>`
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`)
    const doc = dom.window.document
    const host = doc.getElementById('host')!
    expect(host.children).toHaveLength(1)
    expect(host.firstElementChild!.tagName).toBe('SCRIPT')
    expect(doc.getElementById('after')?.textContent).toBe('after')
    expect(doc.querySelectorAll('script')).toHaveLength(1)
    expect(JSON.parse(host.firstElementChild!.textContent!)).toEqual(nasty)
  })

  it('is valid JavaScript too (U+2028/2029 escaped)', () => {
    expect(new Function(`return ${jsonForScript(nasty)}`)()).toEqual(nasty)
  })
})
