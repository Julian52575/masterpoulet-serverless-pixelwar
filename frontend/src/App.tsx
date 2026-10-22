import { useCallback, useEffect, useRef, useState, type MouseEvent, type WheelEvent } from 'react'

type Pixel = { x: number; y: number; color: string; author: string; updatedAt?: string }

const MIN_SCALE = 1
const MAX_SCALE = 64
const DEFAULT_SIZE = 10000
const DEFAULT_TILE = 256
const PALETTE = ['#000000', '#ffffff', '#e50000', '#ff9900', '#ffe600', '#02be01', '#0083c7', '#820080']

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pixels = useRef(new Map<string, Pixel>())
  const tiles = useRef(new Set<string>())
  const drag = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [tile, setTile] = useState(DEFAULT_TILE)
  const [maxBrush, setMaxBrush] = useState(16)
  const [brush, setBrush] = useState(1)
  const [paused, setPaused] = useState(false)
  const [view, setView] = useState({ x: 0, y: 0, scale: 8 })
  const [color, setColor] = useState(PALETTE[2])
  const [author, setAuthor] = useState('anonymous')
  const [info, setInfo] = useState<Pixel | null>(null)
  const [error, setError] = useState('')

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (const p of pixels.current.values()) {
      ctx.fillStyle = p.color
      ctx.fillRect((p.x - view.x) * view.scale, (p.y - view.y) * view.scale, view.scale, view.scale)
    }
  }, [view])

  // Tiles are fetched once each; live deltas arrive over the WebSocket.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const x0 = Math.floor(view.x / tile)
    const y0 = Math.floor(view.y / tile)
    const x1 = Math.floor((view.x + canvas.width / view.scale) / tile)
    const y1 = Math.floor((view.y + canvas.height / view.scale) / tile)
    const last = Math.ceil(size / tile) - 1
    for (let ty = Math.max(0, y0); ty <= Math.min(last, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(last, x1); tx++) {
        const key = `${tx},${ty}`
        if (tiles.current.has(key)) continue
        tiles.current.add(key)
        fetch(`/api/tiles/${tx}/${ty}`)
          .then((r) => r.json())
          .then((list: Pixel[]) => {
            if (!Array.isArray(list)) return
            for (const p of list) pixels.current.set(`${p.x},${p.y}`, p)
            draw()
          })
          .catch(() => tiles.current.delete(key))
      }
    }
  }, [view, draw, size, tile])

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        if (!c?.size) return
        setSize(c.size)
        setTile(c.tile)
        setMaxBrush(c.maxBrush)
        setPaused(c.paused)
      })
      .catch(() => {})
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'pixels.updated') {
        for (const p of msg.payload as Pixel[]) pixels.current.set(`${p.x},${p.y}`, p)
      } else if (msg.type === 'canvas.cleared') {
        pixels.current.clear()
      } else return
      draw()
    }
    return () => ws.close()
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
    draw()
  }, [draw])

  const toCell = (e: MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.floor((e.clientX - r.left) / view.scale + view.x),
      y: Math.floor((e.clientY - r.top) / view.scale + view.y),
    }
  }

  const onWheel = (e: WheelEvent) => {
    const factor = e.deltaY < 0 ? 1.25 : 0.8
    setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor)) }))
  }

  const onMouseDown = (e: MouseEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, moved: false }
  }

  const onMouseMove = (e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (!d.moved) return
    d.sx = e.clientX
    d.sy = e.clientY
    setView((v) => ({ ...v, x: Math.max(0, v.x - dx / v.scale), y: Math.max(0, v.y - dy / v.scale) }))
  }

  const onMouseUp = async (e: MouseEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved) return
    const { x, y } = toCell(e)
    if (x < 0 || y < 0 || x >= size || y >= size) return
    if (e.shiftKey) {
      const known = pixels.current.get(`${x},${y}`)
      const res = await fetch(`/api/pixels/${x}/${y}`)
      setInfo(res.ok ? await res.json() : (known ?? { x, y, color: '-', author: '-' }))
      return
    }
    setError('')
    const res = await fetch(brush > 1 ? '/api/brush' : '/api/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, color, author, size: brush }),
    })
    setPaused(res.status === 423)
    if (!res.ok) {
      setError(
        res.status === 429 ? 'Slow down: rate limited' : res.status === 423 ? 'Drawing is paused' : 'Could not draw',
      )
    }
  }

  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100vh', margin: 0 }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
        <strong>serverless-pixelwar</strong>
        <input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        {PALETTE.map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            style={{ background: c, width: 24, height: 24, border: c === color ? '3px solid #888' : '1px solid #ccc' }}
          />
        ))}
        <label>
          Brush
          <input
            type="number"
            min={1}
            max={maxBrush}
            value={brush}
            onChange={(e) => setBrush(Math.min(maxBrush, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 48 }}
          />
        </label>
        <a href="/api/snapshot.png?w=1024&h=1024" download>
          Snapshot
        </a>
        {paused && <strong>Paused</strong>}
        <span>
          ({Math.floor(view.x)}, {Math.floor(view.y)}) x{view.scale.toFixed(1)} · shift+click to inspect
        </span>
        {error && <span role="alert">{error}</span>}
        {info && (
          <span data-testid="info">
            ({info.x}, {info.y}) {info.color} by {info.author} {info.updatedAt ?? ''}
          </span>
        )}
      </header>
      <canvas
        ref={canvasRef}
        style={{ flex: 1, width: '100%', cursor: 'crosshair' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />
    </main>
  )
}
