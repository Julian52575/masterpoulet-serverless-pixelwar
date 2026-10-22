import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor() {
    FakeWebSocket.instances.push(this)
  }
  close() {}
  send(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

type Reply = { status?: number; body?: unknown }
let colors: string[] = []
let fetchMock: ReturnType<typeof vi.fn>
let replies: Record<string, Reply>

const reply = ({ status = 200, body = [] }: Reply) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  FakeWebSocket.instances = []
  colors = []
  replies = {}
  vi.stubGlobal('WebSocket', FakeWebSocket)
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
const socket = () => FakeWebSocket.instances[0]

async function setup() {
  const utils = render(<App />)
  await screen.findByLabelText('Author')
  const canvas = utils.container.querySelector('canvas')!
  // jsdom canvases sit at (0, 0); at the default scale of 8, client (20, 20) is cell (2, 2).
  const click = (opts: object = {}) => {
    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 20, clientY: 20, pointerId: 1, ...opts })
  }
  return { canvas, click }
}

describe('App', () => {
  it('applies the server config and loads the visible tiles', async () => {
    replies['/api/config'] = {
      body: { size: 10000, tile: 256, maxBrush: 32, paused: true, palette: { gold: '#ffd700' } },
    }
    await setup()
    expect(await screen.findByLabelText('Color gold')).toBeInTheDocument()
    expect(screen.getByLabelText('Brush')).toHaveAttribute('max', '32')
    expect(screen.getByText('Paused')).toBeInTheDocument()
    await waitFor(() => expect(calls('/api/tiles/').length).toBeGreaterThan(0))
  })

  it('draws a single pixel on click', async () => {
    const { click } = await setup()
    click()
    await waitFor(() => expect(calls('/api/pixels')).toHaveLength(1))
    const body = JSON.parse(calls('/api/pixels')[0][1].body)
    expect(body).toMatchObject({ x: 2, y: 2, author: 'anonymous', color: '#e50000' })
  })

  it('uses the brush endpoint when the brush is larger than one', async () => {
    const { click } = await setup()
    fireEvent.change(screen.getByLabelText('Brush'), { target: { value: '4' } })
    fireEvent.click(screen.getByLabelText('Color blue'))
    click()
    await waitFor(() => expect(calls('/api/brush')).toHaveLength(1))
    expect(JSON.parse(calls('/api/brush')[0][1].body)).toMatchObject({ size: 4, color: '#0083c7' })
  })

  it.each([
    [429, 'Slow down: rate limited'],
    [423, 'Drawing is paused'],
    [500, 'Could not draw'],
  ])('explains a %i draw response', async (status, message) => {
    replies['/api/pixels'] = { status }
    const { click } = await setup()
    click()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('inspects a pixel in inspect mode', async () => {
    replies['/api/pixels/2/2'] = {
      body: { x: 2, y: 2, color: '#123456', author: 'bob', updatedAt: '2026-01-01T00:00:00.000Z' },
    }
    const { click } = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    click()
    expect(await screen.findByTestId('info')).toHaveTextContent('by bob')
    expect(calls('/api/pixels/2/2')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('info')).toBeNull()
  })

  it('reports a pixel that was never painted', async () => {
    replies['/api/pixels/2/2'] = { status: 404, body: {} }
    const { click } = await setup()
    click({ shiftKey: true })
    expect(await screen.findByTestId('info')).toHaveTextContent('Never painted')
  })

  it('pans on drag without drawing and shows the hovered cell', async () => {
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

  it('requests a snapshot and offers it once ready', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }))
    await waitFor(() => expect(calls('/api/snapshots')).toHaveLength(1))
    expect(calls('/api/snapshots')[0][1]).toMatchObject({ method: 'POST' })
    socket().send({ type: 'snapshot.ready', payload: { name: 'snapshot-1.png' } })
    expect(await screen.findByText('Download snapshot')).toHaveAttribute('href', '/api/snapshots/snapshot-1.png')
  })

  it('ignores a snapshot event that does not carry a valid name', async () => {
    await setup()
    socket().send({ type: 'snapshot.ready', payload: { name: 'javascript:alert(1)', url: 'javascript:alert(1)' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Download snapshot')).toBeNull()
  })

  it('paints a pixel pushed over the socket on a single connection', async () => {
    await setup()
    socket().send({ type: 'pixels.updated', payload: [{ x: 0, y: 0, color: '#123456', author: 'a' }] })
    await waitFor(() => expect(colors).toContain('#123456'))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('follows pause events', async () => {
    await setup()
    socket().send({ type: 'canvas.paused', payload: {} })
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    socket().send({ type: 'canvas.resumed', payload: {} })
    await waitFor(() => expect(screen.queryByText('Paused')).toBeNull())
  })

  it('refetches a tile invalidated by a large stroke', async () => {
    await setup()
    await waitFor(() => expect(calls('/api/tiles/0/0')).toHaveLength(1))
    socket().send({ type: 'tiles.invalidated', payload: { x0: 0, y0: 0, x1: 300, y1: 300 } })
    await waitFor(() => expect(calls('/api/tiles/0/0')).toHaveLength(2))
  })

  it('clears the canvas and closes the inspector on a clear', async () => {
    replies['/api/pixels/2/2'] = { body: { x: 2, y: 2, color: '#123456', author: 'bob' } }
    const { click } = await setup()
    click({ shiftKey: true })
    await screen.findByTestId('info')
    socket().send({ type: 'canvas.cleared', payload: {} })
    await waitFor(() => expect(screen.queryByTestId('info')).toBeNull())
  })

  it('reconnects and reloads the tiles after the socket drops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await setup()
      await waitFor(() => expect(calls('/api/tiles/0/0')).toHaveLength(1))
      socket().onclose?.()
      await vi.advanceTimersByTimeAsync(1000)
      expect(FakeWebSocket.instances).toHaveLength(2)
      FakeWebSocket.instances[1].onopen?.()
      await waitFor(() => expect(calls('/api/tiles/0/0')).toHaveLength(2))
    } finally {
      vi.useRealTimers()
    }
  })
})
