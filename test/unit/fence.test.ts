import { describe, expect, it } from 'vitest'
import { isLikeC4Fence, NAME_RE, parseFenceOptions, parseViewId } from '../../src/fence'

describe('isLikeC4Fence', () => {
  it('accepts likec4-view with or without options', () => {
    expect(isLikeC4Fence('likec4-view')).toBe(true)
    expect(isLikeC4Fence('  likec4-view browser=false')).toBe(true)
    expect(isLikeC4Fence('likec4-view', '````')).toBe(true)
  })
  it('rejects other info strings', () => {
    expect(isLikeC4Fence('likec4')).toBe(false)
    expect(isLikeC4Fence('likec4-views')).toBe(false)
    expect(isLikeC4Fence('js')).toBe(false)
    expect(isLikeC4Fence('')).toBe(false)
  })
  it('rejects tilde fences, which mkdocs-likec4 does not handle', () => {
    expect(isLikeC4Fence('likec4-view', '~~~')).toBe(false)
  })
})

describe('parseFenceOptions', () => {
  it('uses defaults', () => {
    expect(parseFenceOptions('likec4-view')).toEqual({ browser: true, variant: 'diagram', project: undefined, scheme: 'auto' })
  })
  it('parses options in any order', () => {
    const a = parseFenceOptions('likec4-view browser=false dynamic-variant=sequence project=shop color-scheme=dark')
    const b = parseFenceOptions('likec4-view color-scheme=dark project=shop dynamic-variant=sequence browser=false')
    expect(a).toEqual({ browser: false, variant: 'sequence', project: 'shop', scheme: 'dark' })
    expect(b).toEqual(a)
  })
  it('ignores unknown options and invalid values', () => {
    expect(parseFenceOptions('likec4-view foo=bar browser=maybe color-scheme=pink dynamic-variant=x lone')).toEqual({
      browser: true,
      variant: 'diagram',
      project: undefined,
      scheme: 'auto',
    })
  })
  it('returns project verbatim (validated separately)', () => {
    expect(parseFenceOptions('likec4-view project=9bad').project).toBe('9bad')
    expect(NAME_RE.test('9bad')).toBe(false)
  })
  it('uses the default color scheme when the block sets none', () => {
    expect(parseFenceOptions('likec4-view', 'dark').scheme).toBe('dark')
    expect(parseFenceOptions('likec4-view color-scheme=pink', 'light').scheme).toBe('light')
    expect(parseFenceOptions('likec4-view color-scheme=auto', 'dark').scheme).toBe('auto')
  })

  // Expected values were produced by mkdocs-likec4 1.2.2 `LikeC4Parser.parse_options`.
  const mkdocs: Array<[string, boolean, string, string | undefined, string]> = [
    ['', true, 'diagram', undefined, 'auto'],
    ['browser=false', false, 'diagram', undefined, 'auto'],
    ['browser=false browser=true', false, 'diagram', undefined, 'auto'],
    ['browser=FALSE', true, 'diagram', undefined, 'auto'],
    ['browser=false,project=shop', false, 'diagram', 'shop', 'auto'],
    ['xbrowser=false', true, 'diagram', undefined, 'auto'],
    ['foo-browser=false', false, 'diagram', undefined, 'auto'],
    ['project=shop.', true, 'diagram', 'shop', 'auto'],
    ['project=shop-', true, 'diagram', 'shop', 'auto'],
    ['project=a.b', true, 'diagram', 'a.b', 'auto'],
    ['project="shop"', true, 'diagram', '"shop', 'auto'],
    ['color-scheme=dark color-scheme=light', true, 'diagram', undefined, 'dark'],
    ['dynamic-variant=sequence', true, 'sequence', undefined, 'auto'],
    ['browser = false', true, 'diagram', undefined, 'auto'],
    ['project=', true, 'diagram', undefined, 'auto'],
    ['{browser=false}', false, 'diagram', undefined, 'auto'],
  ]
  it.each(mkdocs)('matches mkdocs-likec4 for %j', (text, browser, variant, project, scheme) => {
    expect(parseFenceOptions(`likec4-view ${text}`)).toEqual({ browser, variant, project, scheme })
  })
})

describe('parseViewId', () => {
  it('takes the single body line, trimmed', () => {
    expect(parseViewId('index\n')).toEqual({ ok: true, viewId: 'index' })
    expect(parseViewId('  index  \r\n')).toEqual({ ok: true, viewId: 'index' })
  })
  it('rejects bodies that are not exactly one line, like mkdocs-likec4', () => {
    for (const body of ['a\nb\n', '\nindex\n', 'index\n\n', 'a\r\nb']) {
      const r = parseViewId(body)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.message).toMatch(/exactly one line/)
    }
  })
  it('reports a missing view id for an empty body', () => {
    for (const body of ['', '\n', '   \n']) {
      const r = parseViewId(body)
      expect(!r.ok && r.message).toMatch(/Missing view id/)
    }
  })
  it('validates names', () => {
    for (const ok of ['index', 'a', 'shop-containers', 'view_1', 'X9']) expect(NAME_RE.test(ok)).toBe(true)
    for (const bad of ['1abc', '-x', 'a b', 'a.b', '', 'ä', 'a/b']) expect(NAME_RE.test(bad)).toBe(false)
  })
})
