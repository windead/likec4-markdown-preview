import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelService } from '../../src/modelService'

const FIXTURES = path.resolve(__dirname, '../../fixtures')

function customerTitle(s: ModelService): string | undefined {
  const view = s.snapshot('shop')?.data?.views.index as any
  return view?.nodes.find((n: any) => n.id === 'customer')?.title
}

async function until(cond: () => boolean, ms = 15000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe('ModelService', () => {
  let dir: string
  let svc: ModelService
  let changes: string[][]
  let logs: string[]
  let modelFile: string

  const create = (watch = false) => {
    changes = []
    logs = []
    svc = new ModelService(dir, { graphviz: 'wasm', watch, log: m => logs.push(m), onDidChange: p => changes.push(p) })
    return svc
  }
  const layoutCount = () => logs.filter(l => l.startsWith('[layout] shop:')).length

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'likec4-ms-'))
    cpSync(FIXTURES, dir, { recursive: true })
    modelFile = path.join(dir, 'shop/model.c4')
  })
  afterEach(async () => {
    await svc?.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('computes the snapshot lazily on first reference', async () => {
    create()
    expect(svc.snapshot('shop')).toBeUndefined()
    await svc.idle()
    const s = svc.snapshot('shop')!
    expect(s.state).toBe('ok')
    expect([...s.viewIds].sort()).toEqual(['checkout', 'index', 'prodDeployment', 'shopContainers'])
    expect(s.modelJson).not.toMatch(/[<>&]/)
    expect(changes).toEqual([['shop']])
    expect(svc.projectIds().sort()).toEqual(['billing', 'shop'])
  })

  it('only recomputes referenced projects', async () => {
    create()
    svc.snapshot('shop')
    await svc.idle()
    expect(logs.some(l => l.startsWith('[layout] billing'))).toBe(false)
  })

  it('recomputes after a file change on disk (watch)', async () => {
    create(true)
    svc.snapshot('shop')
    await svc.idle()
    const h1 = svc.snapshot('shop')!.hash
    writeFileSync(modelFile, readFileSync(modelFile, 'utf8').replace("'Customer'", "'Disk Customer'"))
    await until(() => customerTitle(svc) === 'Disk Customer', 20000)
    expect(svc.snapshot('shop')!.hash).not.toBe(h1)
    expect(changes.length).toBeGreaterThanOrEqual(2)
  })

  it('applies unsaved text and falls back to disk when it is removed', async () => {
    create()
    svc.snapshot('shop')
    await svc.idle()
    const disk = readFileSync(modelFile, 'utf8')
    await svc.setOverlay(modelFile, disk.replace("'Customer'", "'Buyer'"), 1)
    await until(() => customerTitle(svc) === 'Buyer')
    await svc.setOverlay(modelFile, null)
    await until(() => customerTitle(svc) === 'Customer')
    expect(readFileSync(modelFile, 'utf8')).toBe(disk)
  })

  it('keeps the last good model as stale on errors, recovers when fixed', async () => {
    create()
    svc.snapshot('shop')
    await svc.idle()
    const good = svc.snapshot('shop')!
    const disk = readFileSync(modelFile, 'utf8')
    await svc.setOverlay(modelFile, disk.replace("'Customer'", "'Broken' {{{"), 1)
    await until(() => svc.snapshot('shop')!.state === 'stale')
    const stale = svc.snapshot('shop')!
    expect(stale.hash).toBe(good.hash)
    expect(stale.data).toBe(good.data)
    expect(stale.message).toMatch(/errors/)
    await svc.setOverlay(modelFile, disk.replace("'Customer'", "'Fixed'"), 2)
    await until(() => svc.snapshot('shop')!.state === 'ok' && customerTitle(svc) === 'Fixed')
  })

  it('reports error (no history) when the model is broken from the start', async () => {
    writeFileSync(modelFile, readFileSync(modelFile, 'utf8').replace("'Customer'", "'X' {{{"))
    create()
    svc.snapshot('shop')
    await svc.idle()
    expect(svc.snapshot('shop')!.state).toBe('error')
  })

  it('does not report a change when the layout hash is unchanged', async () => {
    create()
    svc.snapshot('shop')
    await svc.idle()
    const n = changes.length
    const disk = readFileSync(modelFile, 'utf8')
    await svc.setOverlay(modelFile, `// just a comment\n${disk}`, 1)
    await until(() => layoutCount() >= 2)
    await svc.idle()
    if (changes.length !== n) console.log(logs.join('\n'), JSON.stringify(changes))
    expect(changes.length).toBe(n)
    expect(logs.at(-1)).toMatch(/unchanged/)
  })

  it('coalesces concurrent edits and ends with the latest text', async () => {
    create()
    svc.snapshot('shop')
    await svc.idle()
    const before = layoutCount()
    const disk = readFileSync(modelFile, 'utf8')
    await Promise.all([1, 2, 3, 4, 5, 6].map(i => svc.setOverlay(modelFile, disk.replace("'Customer'", `'Edit ${i}'`), i)))
    await until(() => customerTitle(svc) === 'Edit 6')
    await svc.idle()
    expect(customerTitle(svc)).toBe('Edit 6')
    expect(layoutCount() - before).toBeLessThan(6)
  })
})
