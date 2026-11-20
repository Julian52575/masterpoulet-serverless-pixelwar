import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import App from './App'

type DocCallback = (snap: { exists: () => boolean; data: () => Record<string, unknown> }) => void
type QueryCallback = (snap: {
  docChanges: () => Array<{
    type: 'added' | 'modified' | 'removed'
    doc: { data: () => Record<string, unknown> }
  }>
}) => void

let docListeners: Map<string, DocCallback>
let queryListeners: Map<string, QueryCallback>
let mockDocs: Map<string, Record<string, unknown>>
let colors: string[]
let fetchMock: ReturnType<typeof vi.fn>
let replies: Record<string, { status?: number; headers?: Record<string, string>; body?: unknown }>

vi.mock('firebase/firestore', () => {
  return {
    getFirestore: () => ({}),
    connectFirestoreEmulator: () => {},
    doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}`, col, id }),
    collection: (_db: unknown, path: string) => ({ path }),
    where: (field: string, op: string, val: unknown) => ({ field, op, val }),
    limit: (n: number) => ({ limit: n }),
    query: (colRef: { path: string }, ...constraints: Array<{ field?: string; op?: string; val?: unknown }>) => {
      const whereClause = constraints.find((c) => c.field === 'tile')
      return { path: colRef.path, tile: whereClause?.val }
    },
    onSnapshot: (target: { path: string; tile?: string }, onNext: (snap: unknown) => void) => {
      if (target.tile) {
        queryListeners.set(String(target.tile), onNext as QueryCallback)
      } else {
        docListeners.set(target.path, onNext as DocCallback)
      }
      return () => {
        if (target.tile) queryListeners.delete(String(target.tile))
        else docListeners.delete(target.path)
      }
    },
    getDoc: async (docRef: { path: string }) => {
      const data = mockDocs.get(docRef.path)
      return {
        exists: () => Boolean(data),
        data: () => data || {},
      }
    },
  }
})

const reply = ({ status = 200, headers = {}, body = {} }: { status?: number; headers?: Record<string, string>; body?: unknown }) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => body,
})

beforeEach(() => {
  docListeners = new Map()
  queryListeners = new Map()
  mockDocs = new Map()
  colors = []
  replies = {}
  sessionStorage.clear()
  window.location.hash = ''

  fetchMock = vi.fn(async (url: string) => reply(replies[url] ?? {}))
  vi.stubGlobal('fetch', fetchMock)
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect() {},
    clearRect() {},
    save() {},
    restore() {},
    drawImage() {},
    set fillStyle(c: string) {
      colors.push(c)
    },
  })
})

const calls = (prefix: string) => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(prefix))

async function setup() {
  const utils = render(<App />)
  const canvas = utils.container.querySelector('canvas')!
  const click = (opts: object = {}) => {
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20, pointerId: 1, ...opts })
  }
  return { canvas, click, ...utils }
}

describe('App', () => {
  it('renders login link when logged out, and requires login to draw', async () => {
    const { click } = await setup()
    expect(screen.getByRole('button', { name: /login with discord/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /login with discord/i })).toHaveAttribute('href', '/api/auth/login')

    click()
    expect(await screen.findByRole('alert')).toHaveTextContent(/please log in with discord to draw/i)
    expect(calls('/api/pixels')).toHaveLength(0)
  })

  it('reads token from URL fragment, stores it, and draws a pixel', async () => {
    window.location.hash = '#access_token=secret_discord_token&token_type=Bearer&expires_in=604800'
    const { click } = await setup()

    expect(await screen.findByText('Logged in')).toBeInTheDocument()
    expect(sessionStorage.getItem('pixelwar_token')).toBe('secret_discord_token')

    click()
    await waitFor(() => expect(calls('/api/pixels')).toHaveLength(1))
    const [url, opts] = calls('/api/pixels')[0]
    expect(url).toBe('/api/pixels')
    expect(opts.headers.Authorization).toBe('Bearer secret_discord_token')
    expect(JSON.parse(opts.body)).toEqual({ x: 2, y: 2, color: '#e50000' })
  })

  it('logs out and clears session token', async () => {
    sessionStorage.setItem('pixelwar_token', 'my_token')
    await setup()
    expect(screen.getByText('Logged in')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(screen.queryByText('Logged in')).toBeNull()
    expect(sessionStorage.getItem('pixelwar_token')).toBeNull()
    expect(screen.getByRole('button', { name: /login with discord/i })).toBeInTheDocument()
  })

  it('uses the brush endpoint when brush size is greater than 1', async () => {
    sessionStorage.setItem('pixelwar_token', 'token_123')
    const { click } = await setup()

    fireEvent.change(screen.getByLabelText('Brush'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText('Color blue'))
    click()

    await waitFor(() => expect(calls('/api/brush')).toHaveLength(1))
    const body = JSON.parse(calls('/api/brush')[0][1].body)
    expect(body).toEqual({ x: 2, y: 2, color: '#0083c7', size: 4 })
  })

  it.each([
    [401, 'Session expired: please log in again'],
    [423, 'Drawing is paused'],
    [429, 'Slow down: rate limited'],
    [503, 'Discord temporarily unavailable, please retry'],
    [500, 'Could not draw'],
  ])('explains a %i draw response', async (status, message) => {
    sessionStorage.setItem('pixelwar_token', 'token_123')
    replies['/api/pixels'] = { status }
    const { click } = await setup()
    click()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    if (status === 401) {
      expect(sessionStorage.getItem('pixelwar_token')).toBeNull()
    }
  })

  it('shows retry after seconds on 429 rate limit', async () => {
    sessionStorage.setItem('pixelwar_token', 'token_123')
    replies['/api/pixels'] = { status: 429, headers: { 'Retry-After': '15' } }
    const { click } = await setup()
    click()
    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down: rate limited (retry in 15s)')
  })

  it('handles auth error in URL fragment', async () => {
    window.location.hash = '#auth_error=access_denied'
    await setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Authentication error: access_denied')
  })

  it('listens to canvas pause state from Firestore', async () => {
    await setup()
    expect(screen.queryByText('Paused')).toBeNull()

    const canvasListener = docListeners.get('state/canvas')
    expect(canvasListener).toBeDefined()

    act(() => {
      canvasListener!({
        exists: () => true,
        data: () => ({ paused: true }),
      })
    })

    expect(await screen.findByText('Paused')).toBeInTheDocument()

    act(() => {
      canvasListener!({
        exists: () => true,
        data: () => ({ paused: false }),
      })
    })

    await waitFor(() => expect(screen.queryByText('Paused')).toBeNull())
  })

  it('clears canvas and closes inspector when cleared_at advances', async () => {
    mockDocs.set('pixels/2_2', { x: 2, y: 2, color: '#123456', author_name: 'alice', updated_at: '2026-01-01T00:00:00Z' })
    const { click } = await setup()

    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    click()
    expect(await screen.findByTestId('info')).toHaveTextContent('by alice')

    const canvasListener = docListeners.get('state/canvas')
    act(() => {
      canvasListener!({
        exists: () => true,
        data: () => ({ paused: false, cleared_at: '2026-02-01T00:00:00Z' }),
      })
    })

    await waitFor(() => expect(screen.queryByTestId('info')).toBeNull())
  })

  it('inspects a pixel with getDoc and displays details', async () => {
    mockDocs.set('pixels/2_2', {
      x: 2,
      y: 2,
      color: '#123456',
      author_name: 'bob',
      updated_at: { toDate: () => new Date('2026-01-01T12:00:00Z') },
    })

    const { click } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    click()

    expect(await screen.findByTestId('info')).toHaveTextContent('by bob')
    expect(screen.getByTestId('info')).toHaveTextContent('#123456')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('info')).toBeNull()
  })

  it('reports a pixel that was never painted during inspection', async () => {
    const { click } = await setup()
    click({ shiftKey: true })
    expect(await screen.findByTestId('info')).toHaveTextContent('Never painted')
  })

  it('updates canvas when live pixel changes arrive via tile listener', async () => {
    await setup()
    const tile0Listener = queryListeners.get('0_0')
    expect(tile0Listener).toBeDefined()

    act(() => {
      tile0Listener!({
        docChanges: () => [
          {
            type: 'added',
            doc: {
              data: () => ({
                x: 0,
                y: 0,
                color: '#336699',
                author_name: 'carol',
                updated_at: '2026-01-01T00:00:00Z',
              }),
            },
          },
        ],
      })
    })

    await waitFor(() => expect(colors).toContain('#336699'))
  })

  it('pans on drag without drawing and shows hover cell', async () => {
    const { canvas } = await setup()
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 16 })
    expect(screen.getByText(/\(5, 2\)/)).toBeInTheDocument()

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20, pointerId: 1 })
    expect(calls('/api/pixels')).toHaveLength(0)

    fireEvent.pointerLeave(canvas)
    expect(screen.getByText(/—/)).toBeInTheDocument()
  })

  it('zooms with the wheel', async () => {
    const { canvas } = await setup()
    fireEvent.wheel(canvas, { deltaY: -1, clientX: 10, clientY: 10 })
    expect(await screen.findByText(/x10\.0/)).toBeInTheDocument()

    fireEvent.wheel(canvas, { deltaY: 1, clientX: 10, clientY: 10 })
    expect(await screen.findByText(/x8\.0/)).toBeInTheDocument()
  })
})
