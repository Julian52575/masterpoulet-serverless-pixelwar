import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

class FakeWebSocket {
  close() {}
}

describe('App', () => {
  it('loads visible tiles and exposes the brush and snapshot tools', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ fillRect() {}, fillStyle: '' })
    render(<App />)
    expect(await screen.findByLabelText('Author')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Brush'), { target: { value: '4' } })
    expect(screen.getByLabelText('Brush')).toHaveValue(4)
    expect(screen.getByText('Snapshot')).toHaveAttribute('href', expect.stringContaining('/api/snapshot.png'))
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/tiles/'))).toBe(true)
  })
})
