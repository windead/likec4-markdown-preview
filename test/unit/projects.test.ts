import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findNearestProject, parseConfigName, resolveProject, SCRIPT_CONFIG_MESSAGE, type ProjectInfo } from '../../src/projects'

const R = path.resolve('/ws')
const p = (name: string, rel: string, kind: ProjectInfo['kind'] = 'json', serviceRoot = R): ProjectInfo => ({
  name,
  root: path.join(R, rel),
  kind,
  configPath: kind === 'default' ? '' : path.join(R, rel, 'likec4.config.json'),
  serviceRoot,
})

describe('parseConfigName', () => {
  it('reads name from JSON and JSON with comments/trailing commas', () => {
    expect(parseConfigName('{"name":"shop"}')).toBe('shop')
    expect(parseConfigName('{\n // c\n "name": "a", /* x */\n}')).toBe('a')
    expect(parseConfigName('{}')).toBeUndefined()
    expect(parseConfigName("{ name: 'json5' }")).toBe('json5')
  })
})

describe('resolveProject', () => {
  const shop = p('shop', 'shop')
  const nested = p('nested', 'shop/sub')
  const billing = p('billing', 'billing')
  const all = [shop, nested, billing]

  it('single project: nearest ancestor', () => {
    expect(resolveProject(path.join(R, 'shop/docs'), undefined, [shop])).toEqual({ ok: true, project: shop })
  })
  it('nested projects: deepest root wins', () => {
    expect(findNearestProject(path.join(R, 'shop/sub/docs'), all)).toBe(nested)
    expect(findNearestProject(path.join(R, 'shop/other'), all)).toBe(shop)
    expect(findNearestProject(path.join(R, 'shopping'), all)).toBeUndefined()
  })
  it('explicit project=', () => {
    expect(resolveProject(path.join(R, 'shop'), 'billing', all)).toEqual({ ok: true, project: billing })
    expect(resolveProject(path.join(R, 'shop'), 'nope', all)).toEqual({ ok: false, message: 'LikeC4 project "nope" not found.' })
  })
  it('multi-root: same name in two roots resolves to the nearest one', () => {
    const r2 = path.resolve('/ws2')
    const other: ProjectInfo = { name: 'shop', root: path.join(r2, 'shop'), kind: 'json', configPath: '', serviceRoot: r2 }
    expect(resolveProject(path.join(r2, 'shop/docs'), 'shop', [shop, other])).toEqual({ ok: true, project: other })
    expect(resolveProject(path.join(r2, 'shop/docs'), undefined, [shop, other])).toEqual({ ok: true, project: other })
  })
  it('no project found', () => {
    expect(resolveProject(path.join(R, 'docs'), undefined, all).ok).toBe(false)
  })
  it('default project when the root has no config', () => {
    const def = p('default', '.', 'default')
    expect(resolveProject(path.join(R, 'docs'), undefined, [def])).toEqual({ ok: true, project: def })
    expect(resolveProject(path.resolve('/elsewhere'), undefined, [def]).ok).toBe(false)
  })
  it('script configs are found but reported as unsupported', () => {
    const js = { ...p('', 'js', 'script'), configPath: path.join(R, 'js/likec4.config.ts') }
    expect(resolveProject(path.join(R, 'js/docs'), undefined, [shop, js])).toEqual({ ok: false, message: SCRIPT_CONFIG_MESSAGE })
  })
  it('without a document directory, a single project is used', () => {
    expect(resolveProject(undefined, undefined, [shop])).toEqual({ ok: true, project: shop })
    expect(resolveProject(undefined, undefined, all).ok).toBe(false)
  })
})
