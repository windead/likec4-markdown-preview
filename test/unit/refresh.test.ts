import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RefreshScheduler, type RefreshHost } from '../../src/refresh'

function host(over: Partial<RefreshHost> = {}) {
  const refreshes: string[] = []
  const h: RefreshHost = {
    documentsReferencing: keys => (keys.includes('A') ? ['file:///a.md'] : []),
    hasOpenPreview: () => true,
    isDocumentOpen: () => true,
    refresh: reason => refreshes.push(reason),
    ...over,
  }
  return { h, refreshes }
}

describe('RefreshScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('merges several changes into one refresh', () => {
    const { h, refreshes } = host()
    const s = new RefreshScheduler(h, 30)
    s.projectsChanged(['A'], 'a1')
    s.projectsChanged(['B'], 'b')
    s.projectsChanged(['A'], 'a2')
    vi.advanceTimersByTime(29)
    expect(refreshes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(refreshes).toEqual(['a1; b; a2'])
  })

  it('does not refresh without an open preview', () => {
    const { h, refreshes } = host({ hasOpenPreview: () => false })
    const s = new RefreshScheduler(h, 30)
    s.projectsChanged(['A'], 'x')
    s.refreshAll('settings')
    vi.runAllTimers()
    expect(refreshes).toEqual([])
  })

  it('does not refresh for projects no open document references', () => {
    const closed = host({ isDocumentOpen: () => false })
    new RefreshScheduler(closed.h, 30).projectsChanged(['A'], 'x')
    const unrelated = host()
    new RefreshScheduler(unrelated.h, 30).projectsChanged(['B'], 'x')
    vi.runAllTimers()
    expect(closed.refreshes).toEqual([])
    expect(unrelated.refreshes).toEqual([])
  })

  it('refreshAll refreshes regardless of references, once', () => {
    const { h, refreshes } = host({ documentsReferencing: () => [] })
    const s = new RefreshScheduler(h, 30)
    s.refreshAll('settings changed')
    s.projectsChanged(['Z'], 'model')
    vi.runAllTimers()
    expect(refreshes).toEqual(['settings changed; model'])
  })

  it('dispose cancels a pending refresh', () => {
    const { h, refreshes } = host()
    const s = new RefreshScheduler(h, 30)
    s.projectsChanged(['A'], 'x')
    s.dispose()
    vi.runAllTimers()
    expect(refreshes).toEqual([])
  })
})
