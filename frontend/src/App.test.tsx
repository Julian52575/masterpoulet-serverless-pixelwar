import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

class FakeWebSocket {
  close() {}
}

describe('App', () => {
  it('fetches the viewport and shows the palette', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({ fillRect() {}, fillStyle: '' })
    render(<App />)
    expect(await screen.findByLabelText('Author')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Color #000000'))
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/pixels?'))).toBe(true)
  })
})
