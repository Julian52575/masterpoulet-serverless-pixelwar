import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import App from './App'

class FakeWebSocket {
  close() {}
}

describe('App', () => {
  it('lists items from the API', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ json: async () => [{ id: 1, title: 'first' }] }),
    )
    render(<App />)
    expect(await screen.findByText('first')).toBeInTheDocument()
  })
})
