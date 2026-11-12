'use client'

import { Button, TextInput, toast } from '@payloadcms/ui'
import { useState } from 'react'

import type { ConnectionResponse, Workspace } from '../types.js'

import { BrandStyles, Logo } from './Brand.js'
import { useConnection } from './useConnection.js'
import { useVersion } from './useVersion.js'
import { WorkspaceMark, WorkspaceMarkStyles } from './WorkspaceMark.js'

const KEYS_URL = 'https://app.vocalstack.com/developers/keys'
const muted = { color: 'var(--theme-elevation-500)' }

/** The installed version, and the newer one when there is one. */
const VersionLine: React.FC = () => {
  const version = useVersion()
  if (!version) return null
  if (version.state !== 'outdated') return <p style={{ ...muted, fontSize: 13, margin: 0 }}>@vocalstack/payload {version.current}</p>
  return (
    <div style={{ background: 'var(--theme-warning-100)', borderRadius: 'var(--style-radius-s, 4px)', fontSize: 13, padding: '10px 12px' }}>
      <strong>@vocalstack/payload {version.latest} is out.</strong> This site runs {version.current}.{' '}
      {version.releaseURL && (
        <a href={version.releaseURL} rel="noreferrer" target="_blank">
          What's new
        </a>
      )}
      <p style={{ margin: '6px 0 0' }}>
        Update it in the site's code (<code>pnpm up @vocalstack/payload</code>), then run <code>payload generate:importmap</code> and, with Postgres or SQLite,{' '}
        <code>payload migrate:create</code> before deploying.
      </p>
    </div>
  )
}

/** The workspace the key works in: its mark and name under a "Workspace" label, with room for a button beside it. */
const WorkspaceRow: React.FC<{ children?: React.ReactNode; workspace: Workspace }> = ({ children, workspace }) => (
  <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
    <WorkspaceMarkStyles />
    <WorkspaceMark size={40} workspace={workspace} />
    <div aria-label={`Workspace: ${workspace.name}`} role="group" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ ...muted, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', lineHeight: 1.4, textTransform: 'uppercase' }}>Workspace</div>
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspace.name}</div>
    </div>
    {children}
  </div>
)

export const ConnectionPanel: React.FC<{ oneClickConnect?: boolean }> = ({ oneClickConnect }) => {
  const { call, cancel, connect, connecting, connection, setConnection } = useConnection()
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

  if (!connection) return <p style={muted}>Checking the VocalStack connection…</p>

  return (
    <div className="vs-brand" style={{ display: 'grid', gap: 'var(--base)', marginBottom: 'calc(var(--base) * 2)', maxWidth: 560 }}>
      <BrandStyles />
      <Logo height={24} />
      {connection.source === 'options' ? (
        <>
          {connection.workspace && <WorkspaceRow workspace={connection.workspace} />}
          <p style={{ margin: 0 }}>Connected with the API key from the plugin config. Change it there.</p>
        </>
      ) : connection.connected ? (
        <>
          {connection.workspace ? (
            <>
              <WorkspaceRow workspace={connection.workspace}>
                {oneClickConnect && (
                  <Button
                    aria-label={connecting ? 'Cancel changing the workspace' : 'Change workspace'}
                    buttonStyle="secondary"
                    disabled={saving}
                    margin={false}
                    onClick={() => {
                      setError(undefined)
                      void (connecting ? cancel() : connect().catch((e) => setError(e.message)))
                    }}
                    size="small"
                  >
                    {connecting ? 'Cancel' : 'Change'}
                  </Button>
                )}
              </WorkspaceRow>
              <p style={{ margin: 0 }}>
                Connected to VocalStack. Audio uploads have a Transcribe button, and what is transcribed here is kept in this workspace and uses its credit.
              </p>
              {oneClickConnect && (
                <p style={{ ...muted, fontSize: 13, margin: 0 }}>
                  {connecting ? (
                    'Choose a workspace in the VocalStack tab, then click Authenticate. Until then this workspace stays connected.'
                  ) : (
                    <>
                      Change connects again, to the workspace you pick in VocalStack. That makes a new API key; the old one keeps working until it is revoked in
                      VocalStack under{' '}
                      <a href={KEYS_URL} rel="noreferrer" target="_blank">
                        Developers → API keys
                      </a>
                      . Transcripts made in another workspace stay in it.
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <p style={{ margin: 0 }}>Connected to VocalStack{connection.account ? ` as ${connection.account}` : ''}. Audio uploads now have a Transcribe button.</p>
          )}
          <div>
            <Button buttonStyle="secondary" disabled={saving || connecting} margin={false} onClick={() => run(() => call('/vocalstack/key', { method: 'DELETE' }), 'Disconnected.')}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>Connect a VocalStack workspace to transcribe audio uploads. Transcriptions are kept in that workspace and use its credit.</p>
          {oneClickConnect && (
            <div>
              <Button disabled={connecting} margin={false} onClick={() => connect().catch((e) => setError(e.message))}>
                {connecting ? 'Waiting for VocalStack…' : 'Connect VocalStack'}
              </Button>
              <p style={{ ...muted, fontSize: 13, marginBottom: 0 }}>Opens VocalStack in a new tab; choose a workspace and click Authenticate there.</p>
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
      <VersionLine />
    </div>
  )
}
