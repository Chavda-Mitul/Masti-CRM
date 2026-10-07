import { useEffect, useState } from 'react'
import { api } from './lib/api'

function App() {
  const [status, setStatus] = useState('checking...')

  useEffect(() => {
    api('/health')
      .then((data) => setStatus(`${data.status} (database: ${data.database})`))
      .catch((err) => setStatus(`unreachable - ${err.message}`))
  }, [])

  return (
    <>
      <h1>Masti CRM</h1>
      <p>Backend: {status}</p>
    </>
  )
}

export default App
