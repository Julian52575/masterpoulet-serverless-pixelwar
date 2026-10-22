import { vi } from 'vitest'
import { TileCache, type Pixel } from './tiles'

const painted: string[] = []
beforeEach(() => {
  painted.length = 0
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect() {},
    clearRect() {},
    set fillStyle(c: string) {
      painted.push(c)
    },
  })
})

const px = (color: string, updatedAt: string): Pixel => ({ x: 1, y: 1, color, author: 'a', updatedAt })

describe('TileCache', () => {
  it('keeps a live delta that is newer than the tile response', () => {
    const cache = new TileCache(256, 10000)
    const gen = cache.open(0, 0)
    cache.apply(px('#222222', '2026-01-01T00:00:02.000Z'))
    cache.fill(0, 0, gen, [px('#111111', '2026-01-01T00:00:01.000Z')])
    expect(cache.get(1, 1)?.color).toBe('#222222')
  })

  it('discards a tile response that started before a clear', () => {
    const cache = new TileCache(256, 10000)
    const gen = cache.open(0, 0)
    cache.clear()
    expect(cache.fill(0, 0, gen, [px('#111111', 't')])).toBe(false)
    expect(cache.get(1, 1)).toBeUndefined()
  })

  it('ignores deltas for tiles that are not loaded', () => {
    expect(new TileCache(256, 10000).apply(px('#111111', 't'))).toBe(false)
  })

  it('drops only the tiles overlapping an invalidated rectangle', () => {
    const cache = new TileCache(256, 10000)
    cache.open(0, 0)
    cache.open(1, 0)
    cache.open(2, 0)
    expect(cache.invalidate({ x0: 0, y0: 0, x1: 512, y1: 10 })).toBe(true)
    expect([cache.has(0, 0), cache.has(1, 0), cache.has(2, 0)]).toEqual([false, false, true])
  })

  it('evicts the least recently drawn tiles', () => {
    const cache = new TileCache(256, 10000, 2)
    cache.open(0, 0)
    cache.open(1, 0)
    cache.open(2, 0)
    cache.evict()
    expect(cache.size).toBe(2)
  })

  it('lists only the tiles inside the viewport', () => {
    const cache = new TileCache(256, 10000)
    expect(cache.visible({ x: 0, y: 0, scale: 1 }, 512, 256)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ])
  })
})
