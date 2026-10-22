import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((e: { data: string }) => void) | null = null
  constructor() {
    FakeWebSocket.instances.push(this)
  }
  close() {}
  send(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

let colors: string[] = []
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  FakeWebSocket.instances = []
  colors = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] })
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

describe('App', () => {
  it('loads visible tiles and exposes the tools', async () => {
    render(<App />)
    expect(await screen.findByLabelText('Author')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Brush'), { target: { value: '4' } })
    expect(screen.getByLabelText('Brush')).toHaveValue(4)
    expect(screen.getByRole('button', { name: 'Inspect' })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/tiles/'))).toBe(true))
  })

  it('paints a pixel pushed over the socket on a single connection', async () => {
    render(<App />)
    await screen.findByLabelText('Author')
    FakeWebSocket.instances[0].send({
      type: 'pixels.updated',
      payload: [{ x: 0, y: 0, color: '#123456', author: 'a' }],
    })
    await waitFor(() => expect(colors).toContain('#123456'))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('follows pause and snapshot events', async () => {
    render(<App />)
    await screen.findByLabelText('Author')
    FakeWebSocket.instances[0].send({ type: 'canvas.paused', payload: {} })
    expect(await screen.findByRole('status')).toHaveTextContent('Paused')
    FakeWebSocket.instances[0].send({ type: 'canvas.resumed', payload: {} })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    FakeWebSocket.instances[0].send({ type: 'snapshot.ready', payload: { url: '/api/snapshots/s.png' } })
    expect(await screen.findByText('Download snapshot')).toHaveAttribute('href', '/api/snapshots/s.png')
  })
})
