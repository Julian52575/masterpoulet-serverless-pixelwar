export type Pixel = { x: number; y: number; color: string; author: string; updatedAt?: string }
export type View = { x: number; y: number; scale: number }

type Tile = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  meta: Map<string, Pixel>
  gen: number
  seen: number
}

const isNewer = (a: Pixel, b: Pixel | undefined) => !b || (a.updatedAt ?? '') >= (b.updatedAt ?? '')

// Each tile is painted once into its own small canvas; a frame is just one drawImage per visible tile.
export class TileCache {
  private readonly tiles = new Map<string, Tile>()
  private gen = 0
  private clock = 0

  constructor(
    readonly tileSize: number,
    readonly gridSize: number,
    private readonly maxTiles = 200,
  ) {}

  has(tx: number, ty: number) {
    return this.tiles.has(`${tx},${ty}`)
  }

  // Creates a blank tile before its data arrives, so live deltas are not lost meanwhile.
  open(tx: number, ty: number) {
    const canvas = document.createElement('canvas')
    canvas.width = this.tileSize
    canvas.height = this.tileSize
    const tile = { canvas, ctx: canvas.getContext('2d'), meta: new Map(), gen: this.gen, seen: this.clock }
    this.blank(tx, ty, tile)
    this.tiles.set(`${tx},${ty}`, tile)
    return this.gen
  }

  // Merges a fetched tile, keeping any pixel a live delta already made newer.
  fill(tx: number, ty: number, gen: number, pixels: Pixel[]) {
    const tile = this.tiles.get(`${tx},${ty}`)
    if (!tile || gen !== this.gen || tile.gen !== gen) return false
    for (const p of pixels) this.paint(tile, p)
    return true
  }

  drop(tx: number, ty: number, gen: number) {
    if (this.tiles.get(`${tx},${ty}`)?.gen === gen) this.tiles.delete(`${tx},${ty}`)
  }

  // Deltas for tiles not in the cache are ignored: those tiles are fetched fresh when they come into view.
  apply(p: Pixel) {
    const tile = this.tiles.get(`${Math.floor(p.x / this.tileSize)},${Math.floor(p.y / this.tileSize)}`)
    if (!tile) return false
    this.paint(tile, p)
    return true
  }

  get(x: number, y: number) {
    return this.tiles.get(`${Math.floor(x / this.tileSize)},${Math.floor(y / this.tileSize)}`)?.meta.get(`${x},${y}`)
  }

  // In-flight tile fetches started before the clear are discarded by the generation bump.
  clear() {
    this.gen++
    for (const [key, tile] of this.tiles) {
      const [tx, ty] = key.split(',').map(Number)
      tile.meta.clear()
      tile.gen = this.gen
      this.blank(tx, ty, tile)
    }
  }

  // Drops cached tiles overlapping a changed rectangle (end-exclusive) so they are fetched fresh.
  invalidate(r: { x0: number; y0: number; x1: number; y1: number }) {
    const t = this.tileSize
    let dropped = false
    for (let ty = Math.floor(r.y0 / t); ty <= Math.floor((r.y1 - 1) / t); ty++) {
      for (let tx = Math.floor(r.x0 / t); tx <= Math.floor((r.x1 - 1) / t); tx++) {
        dropped = this.tiles.delete(`${tx},${ty}`) || dropped
      }
    }
    return dropped
  }

  reset() {
    this.gen++
    this.tiles.clear()
  }

  visible(view: View, width: number, height: number) {
    const last = Math.ceil(this.gridSize / this.tileSize) - 1
    const t = this.tileSize
    const x0 = Math.max(0, Math.floor(view.x / t))
    const y0 = Math.max(0, Math.floor(view.y / t))
    const x1 = Math.min(last, Math.floor((view.x + width / view.scale) / t))
    const y1 = Math.min(last, Math.floor((view.y + height / view.scale) / t))
    const out: [number, number][] = []
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) out.push([tx, ty])
    return out
  }

  draw(ctx: CanvasRenderingContext2D, view: View, width: number, height: number) {
    this.clock++
    const s = view.scale
    ctx.clearRect(0, 0, width, height)
    // The grid is a white sheet with a soft shadow so its edges stand out from the page.
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
    ctx.shadowBlur = 24
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-view.x * s, -view.y * s, this.gridSize * s, this.gridSize * s)
    ctx.restore()
    ctx.imageSmoothingEnabled = false
    const t = this.tileSize
    for (const [tx, ty] of this.visible(view, width, height)) {
      const tile = this.tiles.get(`${tx},${ty}`)
      if (!tile) continue
      tile.seen = this.clock
      ctx.drawImage(tile.canvas, (tx * t - view.x) * s, (ty * t - view.y) * s, t * s, t * s)
    }
  }

  // Bounds memory: drops the least recently drawn tiles beyond `maxTiles`.
  evict() {
    if (this.tiles.size <= this.maxTiles) return
    const oldest = [...this.tiles].sort((a, b) => a[1].seen - b[1].seen)
    for (const [key] of oldest.slice(0, this.tiles.size - this.maxTiles)) this.tiles.delete(key)
  }

  get size() {
    return this.tiles.size
  }

  private paint(tile: Tile, p: Pixel) {
    const key = `${p.x},${p.y}`
    if (!isNewer(p, tile.meta.get(key))) return
    tile.meta.set(key, p)
    if (!tile.ctx) return
    tile.ctx.fillStyle = p.color
    tile.ctx.fillRect(p.x % this.tileSize, p.y % this.tileSize, 1, 1)
  }

  // The last row/column of tiles overhangs the grid; only the in-grid part is white.
  private blank(tx: number, ty: number, tile: Tile) {
    if (!tile.ctx) return
    const t = this.tileSize
    tile.ctx.clearRect(0, 0, t, t)
    tile.ctx.fillStyle = '#ffffff'
    tile.ctx.fillRect(0, 0, Math.min(t, this.gridSize - tx * t), Math.min(t, this.gridSize - ty * t))
  }
}
