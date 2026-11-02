import { describe, expect, it } from 'vitest'
import { fitViewport, isViewportUsable } from '../../preview/viewport'

describe('viewport helpers', () => {
  const b = { x: 0, y: 0, width: 320, height: 826 }
  it('fitViewport matches LikeC4 initial fit (16px padding, zoom <= 1, centered)', () => {
    // frame exactly bounds + 32px: zoom 1, offset 16
    expect(fitViewport(b, 352, 858)).toEqual({ x: 16, y: 16, zoom: 1 })
    const v = fitViewport(b, 352, 600)
    expect(v.zoom).toBeCloseTo((600 - 32) / 826, 6)
    expect(v.y).toBe(16)
    expect(v.x).toBe(Math.round(176 - 160 * v.zoom))
  })
  it('isViewportUsable detects content moved out of sight', () => {
    expect(isViewportUsable({ x: 16, y: 16, zoom: 1, w: 352, h: 600 }, b)).toBe(true)
    expect(isViewportUsable({ x: -5000, y: 16, zoom: 1, w: 352, h: 600 }, b)).toBe(false)
    expect(isViewportUsable({ x: 16, y: 2000, zoom: 1, w: 352, h: 600 }, b)).toBe(false)
  })
})
