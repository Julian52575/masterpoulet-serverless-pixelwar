import { useEffect, useState, type FormEvent } from 'react'

type Item = { id: number; title: string }

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [title, setTitle] = useState('')

  const load = () =>
    fetch('/api/items')
      .then((r) => r.json())
      .then(setItems)

  useEffect(() => {
    load()
    // Refresh whenever the backend announces a new item over RabbitMQ -> WebSocket.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onmessage = () => load()
    return () => ws.close()
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    setTitle('')
  }

  return (
    <main>
      <h1>serverless-pixelwar (placeholder)</h1>
      <form onSubmit={add}>
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>
      <ul>
        {items.map((i) => (
          <li key={i.id}>{i.title}</li>
        ))}
      </ul>
    </main>
  )
}
