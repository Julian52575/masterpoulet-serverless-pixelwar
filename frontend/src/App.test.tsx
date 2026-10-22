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
}

describe('App', () => {
  it('loads visible tiles and exposes the brush and snapshot tools', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ fillRect() {}, clearRect() {}, save() {}, restore() {}, fillStyle: '' })
    render(<App />)
    expect(await screen.findByLabelText('Author')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Brush'), { target: { value: '4' } })
    expect(screen.getByLabelText('Brush')).toHaveValue(4)
    expect(screen.getByText('Snapshot')).toHaveAttribute('href', expect.stringContaining('/api/snapshot.png'))
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/tiles/'))).toBe(true)
  })

  it('paints a pixel pushed over the socket without refetching', async () => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const colors: string[] = []
    const ctx = {
      fillRect() {},
      clearRect() {},
      save() {},
      restore() {},
      set fillStyle(c: string) {
        colors.push(c)
      },
    }
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(ctx)
    render(<App />)
    await screen.findByLabelText('Author')
    FakeWebSocket.instances[0].onmessage?.({
      data: JSON.stringify({ type: 'pixels.updated', payload: [{ x: 0, y: 0, color: '#123456', author: 'a' }] }),
    })
    await waitFor(() => expect(colors).toContain('#123456'))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
