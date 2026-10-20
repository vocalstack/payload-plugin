'use client'

import { Button, TextInput, toast } from '@payloadcms/ui'
import { useState } from 'react'

import type { ConnectionResponse } from '../types.js'

import { BrandStyles, Logo } from './Brand.js'
import { useConnection } from './useConnection.js'

const KEYS_URL = 'https://app.vocalstack.com/developers/keys'

export const ConnectionPanel: React.FC<{ oneClickConnect?: boolean }> = ({ oneClickConnect }) => {
  const { call, connect, connecting, connection, setConnection } = useConnection()
  const [apiKey, setAPIKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const run = async (fn: () => Promise<ConnectionResponse>, done: string) => {
    setSaving(true)
    setError(undefined)
    try {
      setConnection(await fn())
      setAPIKey('')
      toast.success(done)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const save = () => void run(() => call('/vocalstack/key', { body: JSON.stringify({ apiKey }), method: 'POST' }), 'Connected to VocalStack.')

  const muted = { color: 'var(--theme-elevation-500)' }

  if (!connection) return <p style={muted}>Checking the VocalStack connection…</p>

  if (connection.source === 'options') {
    return <p style={muted}>Connected with the API key from the plugin config. Change it there.</p>
  }

  return (
    <div className="vs-brand" style={{ display: 'grid', gap: 'var(--base)', marginBottom: 'calc(var(--base) * 2)', maxWidth: 560 }}>
      <BrandStyles />
      <Logo height={24} />
      {connection.connected ? (
        <>
          <p style={{ margin: 0 }}>Connected to VocalStack{connection.account ? ` as ${connection.account}` : ''}. Audio uploads now have a Transcribe button.</p>
          <div>
            <Button buttonStyle="secondary" disabled={saving} margin={false} onClick={() => run(() => call('/vocalstack/key', { method: 'DELETE' }), 'Disconnected.')}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>Connect a VocalStack account to transcribe audio uploads. Transcriptions use that account's credit.</p>
          {oneClickConnect && (
            <div>
              <Button disabled={connecting} margin={false} onClick={() => connect().catch((e) => setError(e.message))}>
                {connecting ? 'Waiting for VocalStack…' : 'Connect VocalStack'}
              </Button>
              <p style={{ ...muted, fontSize: 13, marginBottom: 0 }}>Opens VocalStack in a new tab; click Authenticate there.</p>
            </div>
          )}
          {/* Not a <form>: this renders inside Payload's own document form. */}
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter' && apiKey.trim()) {
                e.preventDefault()
                save()
              }
            }}
            style={{ display: 'grid', gap: 'calc(var(--base) / 2)' }}
          >
            <TextInput
              label={oneClickConnect ? 'Or paste an API key' : 'API key'}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAPIKey(e.target.value)}
              path="vocalstack-api-key"
              placeholder="vs_key_…"
              value={apiKey}
            />
            <p style={{ ...muted, fontSize: 13, margin: 0 }}>
              Create one with Read and Write permissions under{' '}
              <a href={KEYS_URL} rel="noreferrer" target="_blank">
                Developers → API keys
              </a>
              . It is stored on the server and never shown again.
            </p>
            <div>
              <Button disabled={saving || !apiKey.trim()} margin={false} onClick={save}>
                Save key
              </Button>
            </div>
          </div>
        </>
      )}
      {error && <p style={{ color: 'var(--theme-error-500)', margin: 0 }}>{error}</p>}
    </div>
  )
}
