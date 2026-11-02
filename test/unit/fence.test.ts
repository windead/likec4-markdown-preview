import { describe, expect, it } from 'vitest'
import { isLikeC4Fence, NAME_RE, parseFenceOptions, parseViewId } from '../../src/fence'

describe('isLikeC4Fence', () => {
  it('accepts likec4-view with or without options', () => {
    expect(isLikeC4Fence('likec4-view')).toBe(true)
    expect(isLikeC4Fence('  likec4-view browser=false')).toBe(true)
  })
  it('rejects other info strings', () => {
    expect(isLikeC4Fence('likec4')).toBe(false)
    expect(isLikeC4Fence('likec4-views')).toBe(false)
    expect(isLikeC4Fence('js')).toBe(false)
    expect(isLikeC4Fence('')).toBe(false)
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
})

describe('parseViewId', () => {
  it('takes the first non-empty line', () => {
    expect(parseViewId('\n\n  index  \nignored\n')).toBe('index')
    expect(parseViewId('a\r\nb')).toBe('a')
  })
  it('returns empty string for empty body', () => {
    expect(parseViewId('')).toBe('')
    expect(parseViewId('   \n \n')).toBe('')
  })
  it('validates names', () => {
    for (const ok of ['index', 'a', 'shop-containers', 'view_1', 'X9']) expect(NAME_RE.test(ok)).toBe(true)
    for (const bad of ['1abc', '-x', 'a b', 'a.b', '', 'ä', 'a/b']) expect(NAME_RE.test(bad)).toBe(false)
  })
})
