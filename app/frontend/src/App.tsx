import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'
import { db as defaultDb } from './firebase'
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

const DRAW_ERRORS: Record<number, string> = {
  401: 'Session expired: please log in again',
  423: 'Drawing is paused',
  429: 'Slow down: rate limited',
  503: 'Discord temporarily unavailable, please retry',
}

// Keeps the grid on screen: no panning past its edges.
function clampView(v: View, width: number, height: number, size: number): View {
  const maxX = Math.max(0, size - width / v.scale)
  const maxY = Math.max(0, size - height / v.scale)
  return { ...v, x: Math.min(maxX, Math.max(0, v.x)), y: Math.min(maxY, Math.max(0, v.y)) }
}

export default function App({ db = defaultDb }: { db?: Firestore }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const config = DEFAULT_CONFIG
  const cache = useMemo(() => new TileCache(config.tile, config.size), [config.tile, config.size])
  const cacheRef = useRef(cache)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 8 })
  const viewRef = useRef(view)
  const [dims, setDims] = useState({ width: 0, height: 0 })
  const frame = useRef(0)
  const pointer = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)

  const [mode, setMode] = useState<Mode>('draw')
  const [color, setColor] = useState(DEFAULT_CONFIG.palette.red)
  const [brush, setBrush] = useState(1)
  const [token, setToken] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState('')

  const lastClearedAt = useRef<number | null>(null)
  const tileSubs = useRef<Map<string, () => void>>(new Map())

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

  // Handle OAuth fragment callback on mount and restore token from sessionStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    if (hash && hash.startsWith('#')) {
      const params = new URLSearchParams(hash.slice(1))
      const accessToken = params.get('access_token')
      const authError = params.get('auth_error')
      if (accessToken) {
        sessionStorage.setItem('pixelwar_token', accessToken)
        setToken(accessToken)
      } else if (authError) {
        setError(`Authentication error: ${authError}`)
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } else {
      const stored = sessionStorage.getItem('pixelwar_token')
      if (stored) setToken(stored)
    }
  }, [])

  // Listen to canvas state (paused, cleared_at)
  useEffect(() => {
    if (!db) return
    const unsub = onSnapshot(doc(db, 'state', 'canvas'), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      setPaused(Boolean(data.paused))

      const cleared = data.cleared_at
      const clearedMs = cleared?.toMillis ? cleared.toMillis() : cleared ? new Date(cleared).getTime() : null
      if (clearedMs !== null && (lastClearedAt.current === null || clearedMs > lastClearedAt.current)) {
        lastClearedAt.current = clearedMs
        cacheRef.current.clear()
        setInfo(null)
        schedule()
      }
    })
    return () => unsub()
  }, [db, schedule])

  // Canvas resize listener
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

  // Visible tiles subscription via Firestore live listeners
  useEffect(() => {
    viewRef.current = view
    if (!db) return
    const visibleTiles = cache.visible(view, dims.width, dims.height)
    const currentKeys = new Set<string>()

    for (const [tx, ty] of visibleTiles) {
      const key = `${tx}_${ty}`
      currentKeys.add(key)
      if (tileSubs.current.has(key)) continue

      cache.open(tx, ty)
      const q = query(collection(db, 'pixels'), where('tile', '==', key), limit(65536))
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
              const d = change.doc.data()
              const updatedAt = d.updated_at?.toDate ? d.updated_at.toDate().toISOString() : d.updated_at
              cacheRef.current.apply({
                x: d.x,
                y: d.y,
                color: d.color,
                author: d.author_name ?? d.author ?? 'anonymous',
                updatedAt,
              })
            }
          }
          schedule()
        },
        () => {
          // Unsubscribe on error
          tileSubs.current.get(key)?.()
          tileSubs.current.delete(key)
        },
      )
      tileSubs.current.set(key, unsub)
    }

    // Evict listeners for tiles no longer visible if set grows too large
    if (tileSubs.current.size > 100) {
      for (const [key, unsub] of tileSubs.current.entries()) {
        if (!currentKeys.has(key)) {
          unsub()
          tileSubs.current.delete(key)
        }
      }
    }
    cache.evict()
    schedule()
  }, [view, dims, cache, db, schedule])

  // Cleanup all tile subscriptions on unmount
  useEffect(() => {
    return () => {
      for (const unsub of tileSubs.current.values()) unsub()
      tileSubs.current.clear()
    }
  }, [])

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
    if (!db) return
    try {
      const snap = await getDoc(doc(db, 'pixels', `${x}_${y}`))
      if (snap.exists()) {
        const d = snap.data()
        const updatedAt = d.updated_at?.toDate ? d.updated_at.toDate().toISOString() : d.updated_at
        setInfo({
          x,
          y,
          pixel: {
            x: d.x,
            y: d.y,
            color: d.color,
            author: d.author_name ?? (d.author ? `by <@${d.author}>` : 'unknown'),
            updatedAt,
          },
        })
      } else {
        setInfo({ x, y, pixel: cache.get(x, y) })
      }
    } catch {
      setInfo({ x, y, pixel: cache.get(x, y) })
    }
  }

  const paint = async (x: number, y: number) => {
    setError('')
    if (!token) {
      setError('Please log in with Discord to draw')
      return
    }
    if (paused) {
      setError('Drawing is paused')
      return
    }

    try {
      const res = await fetch(brush > 1 ? '/api/brush' : '/api/pixels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(brush > 1 ? { x, y, color, size: brush } : { x, y, color }),
      })

      if (res.status === 401) {
        sessionStorage.removeItem('pixelwar_token')
        setToken(null)
      } else if (res.status === 423) {
        setPaused(true)
      }

      if (!res.ok) {
        const retryAfter = res.headers.get('Retry-After')
        const baseMsg = DRAW_ERRORS[res.status] ?? 'Could not draw'
        setError(res.status === 429 && retryAfter ? `${baseMsg} (retry in ${retryAfter}s)` : baseMsg)
      }
    } catch {
      setError('Could not reach backend')
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    const p = pointer.current
    pointer.current = null
    if (!p || p.moved) return
    const { x, y } = toCell(e.clientX, e.clientY)
    if (x < 0 || y < 0 || x >= config.size || y >= config.size) return
    if (mode === 'inspect' || e.shiftKey) void inspect(x, y)
    else void paint(x, y)
  }

  const logout = () => {
    sessionStorage.removeItem('pixelwar_token')
    setToken(null)
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

        {token ? (
          <>
            <span style={{ fontSize: '0.9em', color: '#166534', fontWeight: 600 }}>Logged in</span>
            <button onClick={logout}>Logout</button>
          </>
        ) : (
          <a
            href="/api/auth/login"
            role="button"
            style={{
              padding: '4px 8px',
              background: '#5865F2',
              color: '#fff',
              borderRadius: 4,
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Login with Discord
          </a>
        )}

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
          {'Brush '}
          <input
            type="number"
            min={1}
            max={config.maxBrush}
            value={brush}
            onChange={(e) => setBrush(Math.min(config.maxBrush, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 56 }}
          />
        </label>

        {paused && (
          <output>
            <strong>Paused</strong>
          </output>
        )}

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
