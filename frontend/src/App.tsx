import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { TileCache, type Pixel, type View } from './tiles'

type Config = { size: number; tile: number; maxBrush: number; palette: Record<string, string> }
type Info = { x: number; y: number; pixel?: Pixel }
type Mode = 'draw' | 'inspect'

const MIN_SCALE = 1
const MAX_SCALE = 64
const DEFAULT_CONFIG: Config = {
  size: 10000,
  tile: 256,
  maxBrush: 16,
  palette: {
    black: '#000000',
    white: '#ffffff',
    red: '#e50000',
    orange: '#ff9900',
    yellow: '#ffe600',
    green: '#02be01',
    blue: '#0083c7',
    purple: '#820080',
  },
}

const nextFrame = (cb: () => void) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16)

// Keeps the grid on screen: no panning past its edges.
function clampView(v: View, width: number, height: number, size: number): View {
  const maxX = Math.max(0, size - width / v.scale)
  const maxY = Math.max(0, size - height / v.scale)
  return { ...v, x: Math.min(maxX, Math.max(0, v.x)), y: Math.min(maxY, Math.max(0, v.y)) }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const cache = useMemo(() => new TileCache(config.tile, config.size), [config.tile, config.size])
  const cacheRef = useRef(cache)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 8 })
  const viewRef = useRef(view)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const [reload, setReload] = useState(0)
  const frame = useRef(0)
  const pointer = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)

  const [mode, setMode] = useState<Mode>('draw')
  const [color, setColor] = useState(DEFAULT_CONFIG.palette.red)
  const [brush, setBrush] = useState(1)
  const [author, setAuthor] = useState('anonymous')
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [error, setError] = useState('')

  const render = useCallback(() => {
    frame.current = 0
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) cacheRef.current.draw(ctx, viewRef.current, canvas.width, canvas.height)
  }, [])

  // Bursts of deltas are coalesced into one repaint per frame.
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = nextFrame(render)
  }, [render])

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        if (!c?.size) return
        setConfig({ size: c.size, tile: c.tile, maxBrush: c.maxBrush, palette: c.palette ?? DEFAULT_CONFIG.palette })
        setPaused(Boolean(c.paused))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
      setDims({ width: canvas.width, height: canvas.height })
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    cacheRef.current = cache
    schedule()
  }, [cache, schedule])

  // Loads tiles entering the viewport; everything after that arrives as deltas over the socket.
  useEffect(() => {
    viewRef.current = view
    for (const [tx, ty] of cache.visible(view, dims.width, dims.height)) {
      if (cache.has(tx, ty)) continue
      const gen = cache.open(tx, ty)
      fetch(`/api/tiles/${tx}/${ty}`)
        .then((r) => r.json())
        .then((list: Pixel[]) => {
          if (Array.isArray(list) && cache.fill(tx, ty, gen, list)) schedule()
        })
        .catch(() => cache.drop(tx, ty, gen))
    }
    cache.evict()
    schedule()
  }, [view, dims, cache, reload, schedule])

  // One socket for the page's lifetime. After a reconnect, deltas may have been missed,
  // so the cache is dropped and the visible tiles are fetched again.
  useEffect(() => {
    let ws: WebSocket | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    let reconnected = false
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        if (!reconnected) return
        cacheRef.current.reset()
        setReload((n) => n + 1)
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        switch (msg.type) {
          case 'pixels.updated':
            for (const p of msg.payload as Pixel[]) cacheRef.current.apply(p)
            schedule()
            break
          case 'tiles.invalidated':
            if (cacheRef.current.invalidate(msg.payload)) setReload((n) => n + 1)
            break
          case 'canvas.cleared':
            cacheRef.current.clear()
            setInfo(null)
            schedule()
            break
          case 'canvas.paused':
            setPaused(true)
            break
          case 'canvas.resumed':
            setPaused(false)
            break
          case 'snapshot.ready':
            setSnapshot(msg.payload.url)
            break
        }
      }
      ws.onclose = () => {
        if (closed) return
        reconnected = true
        timer = setTimeout(connect, 1000)
      }
    }
    connect()
    return () => {
      closed = true
      clearTimeout(timer)
      ws?.close()
    }
  }, [schedule])

  const toCell = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.floor((clientX - r.left) / view.scale + view.x),
      y: Math.floor((clientY - r.top) / view.scale + view.y),
    }
  }

  // Zooms around the cursor so the pixel under it stays put.
  const onWheel = (e: WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const factor = e.deltaY < 0 ? 1.25 : 0.8
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
      const next = { scale, x: mx / v.scale + v.x - mx / scale, y: my / v.scale + v.y - my / scale }
      return clampView(next, dims.width, dims.height, config.size)
    })
  }

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointer.current = { sx: e.clientX, sy: e.clientY, moved: false }
  }

  const onPointerMove = (e: PointerEvent) => {
    const cell = toCell(e.clientX, e.clientY)
    setHover(cell.x >= 0 && cell.y >= 0 && cell.x < config.size && cell.y < config.size ? cell : null)
    const p = pointer.current
    if (!p) return
    const dx = e.clientX - p.sx
    const dy = e.clientY - p.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true
    if (!p.moved) return
    p.sx = e.clientX
    p.sy = e.clientY
    setView((v) =>
      clampView({ ...v, x: v.x - dx / v.scale, y: v.y - dy / v.scale }, dims.width, dims.height, config.size),
    )
  }

  const inspect = async (x: number, y: number) => {
    const res = await fetch(`/api/pixels/${x}/${y}`)
    setInfo({ x, y, pixel: res.ok ? await res.json() : cache.get(x, y) })
  }

  const paint = async (x: number, y: number) => {
    setError('')
    const res = await fetch(brush > 1 ? '/api/brush' : '/api/pixels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, color, author, size: brush }),
    })
    if (res.status === 423) setPaused(true)
    if (!res.ok) {
      setError(
        res.status === 429 ? 'Slow down: rate limited' : res.status === 423 ? 'Drawing is paused' : 'Could not draw',
      )
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    const p = pointer.current
    pointer.current = null
    if (!p || p.moved) return
    const { x, y } = toCell(e.clientX, e.clientY)
    if (x < 0 || y < 0 || x >= config.size || y >= config.size) return
    if (mode === 'inspect' || e.shiftKey) inspect(x, y)
    else paint(x, y)
  }

  const requestSnapshot = async () => {
    setSnapshot(null)
    const res = await fetch('/api/snapshots', { method: 'POST' })
    if (!res.ok) setError('Could not request a snapshot')
  }

  const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '')

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        margin: 0,
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 15% 20%, #7c5cff 0%, transparent 45%), radial-gradient(circle at 85% 30%, #00c2ff 0%, transparent 50%), radial-gradient(circle at 50% 90%, #ff6bb5 0%, transparent 55%), #2a2a3d',
      }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: 8,
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <strong>serverless-pixelwar</strong>
        <input aria-label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        {(['draw', 'inspect'] as const).map((m) => (
          <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} style={{ fontWeight: mode === m ? 700 : 400 }}>
            {m === 'draw' ? 'Draw' : 'Inspect'}
          </button>
        ))}
        {Object.entries(config.palette).map(([name, c]) => (
          <button
            key={name}
            aria-label={`Color ${name}`}
            title={name}
            onClick={() => setColor(c)}
            style={{ background: c, width: 24, height: 24, border: c === color ? '3px solid #444' : '1px solid #ccc' }}
          />
        ))}
        <input aria-label="Custom color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <label>
          Brush
          <input
            type="number"
            min={1}
            max={config.maxBrush}
            value={brush}
            onChange={(e) => setBrush(Math.min(config.maxBrush, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 56 }}
          />
        </label>
        <button onClick={requestSnapshot}>Snapshot</button>
        {snapshot && (
          <a href={snapshot} download>
            Download snapshot
          </a>
        )}
        {paused && <strong role="status">Paused</strong>}
        <span>
          {hover ? `(${hover.x}, ${hover.y})` : '—'} x{view.scale.toFixed(1)}
        </span>
        {error && <span role="alert">{error}</span>}
      </header>
      {info && (
        <aside
          data-testid="info"
          style={{ position: 'absolute', right: 16, top: 72, padding: 12, background: '#fff', borderRadius: 8 }}
        >
          <div>
            Pixel ({info.x}, {info.y})
          </div>
          {info.pixel ? (
            <>
              <div>
                <span style={{ display: 'inline-block', width: 12, height: 12, background: info.pixel.color }} />{' '}
                {info.pixel.color}
              </div>
              <div>by {info.pixel.author}</div>
              <div>{formatDate(info.pixel.updatedAt)}</div>
            </>
          ) : (
            <div>Never painted</div>
          )}
          <button onClick={() => setInfo(null)}>Close</button>
        </aside>
      )}
      <canvas
        ref={canvasRef}
        style={{ flex: 1, width: '100%', minHeight: 0, cursor: mode === 'inspect' ? 'help' : 'crosshair', touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
      />
    </main>
  )
}
