'use client'

import { Button, toast, useConfig, useDocumentInfo, useForm } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Languages } from '../api.js'
import type { SpeakerAnswer, SpeakerFieldData, SpeakerSource } from '../types.js'

import { BrandStyles, Logo } from './Brand.js'
import { useAPI, useConnection } from './useConnection.js'
import { RecordSample, VoiceFromRecording } from './VoiceSamples.js'

const POLL_MS = 3000
const MIN_S = 30

const styles = `
  .vs-voice-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .vs-voice select, .vs-voice input[type=file] { width: 100%; font: inherit; }
  .vs-voice select { padding: 6px 8px; border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 4px);
    background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); }
`

/** Ogg/Opus where the browser plays it, else CAF (Safari). */
const previewFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'caf')

export const SpeakerField: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo()
  const { dispatchFields } = useForm()
  const { connection } = useConnection()
  const call = useAPI()
  const base = `/${collectionSlug}/${id}/vocalstack/speaker`

  const [voice, setVoice] = useState<SpeakerFieldData>()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep the form's copy in step with the server's, so saving the document keeps the speaker.
  const apply = useCallback(
    (res: SpeakerAnswer) => {
      setVoice(res.vocalstackSpeaker)
      if (res.name) setName(res.name)
      for (const group of ['vocalstackSpeaker', 'vocalstackVoice'] as const) {
        for (const [key, value] of Object.entries(res[group] ?? {})) {
          dispatchFields({ type: 'UPDATE', initialValue: value, path: `${group}.${key}`, value })
        }
      }
    },
    [dispatchFields],
  )

  const refresh = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const res = await call<SpeakerAnswer>(base)
      apply(res)
      setError(undefined)
      if (res.vocalstackSpeaker.state === 'training') timer.current = setTimeout(refresh, POLL_MS)
    } catch (err) {
      setError((err as Error).message)
      // Unavailable for now: keep checking on a training voice, more slowly.
      if (voice?.state === 'training') timer.current = setTimeout(refresh, POLL_MS * 3)
    }
  }, [apply, base, call, voice?.state])

  useEffect(() => {
    if (id && connection?.connected) void refresh()
    return () => clearTimeout(timer.current)
    // Once per document; `refresh` re-arms itself while training.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, connection?.connected])

  const remove = async () => {
    if (!window.confirm(`Delete ${name || 'this speaker'} from VocalStack, with their cloned voice? Readings already made with it stay as they are.`)) return
    setBusy(true)
    try {
      apply(await call(base, { method: 'DELETE' }))
      toast.success('Speaker deleted.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  const state = voice?.state ?? 'none'

  return (
    <div className="field-type vs-brand vs-voice" style={{ marginBottom: 'var(--base)' }}>
      <BrandStyles />
      <style>{styles}</style>
      <div className="field-label" style={{ alignItems: 'center', display: 'flex', gap: 8, marginBottom: 'calc(var(--base) / 2)' }}>
        <Logo height={14} /> <span>Speaker</span>
      </div>
      {!id ? (
        <p style={muted}>Save first, then save them as a speaker.</p>
      ) : connection && !connection.connected ? (
        <p style={muted}>Connect VocalStack (Settings → VocalStack) to save them as a speaker.</p>
      ) : !voice ? (
        <p style={muted}>{error ?? 'Checking…'}</p>
      ) : creating || state === 'none' || state === 'failed' ? (
        creating ? (
          <CreateVoice
            base={base}
            name={name}
            onCancel={() => setCreating(false)}
            onCreated={(res) => {
              apply(res)
              setCreating(false)
              timer.current = setTimeout(refresh, POLL_MS)
            }}
          />
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {state === 'failed' ? (
              <p style={{ ...muted, color: 'var(--theme-error-500)' }}>The voice could not be made: {voice.error ?? 'VocalStack gave no reason'}.</p>
            ) : (
              <p style={muted}>Clone {name || 'their'} voice to read translations aloud in it.</p>
            )}
            <div>
              <Button margin={false} onClick={() => setCreating(true)} size="small">
                {state === 'failed' ? 'Try again' : 'Create a voice'}
              </Button>
            </div>
          </div>
        )
      ) : state === 'training' ? (
        <div>
          <p style={muted}>Training the voice{voice.progress ? ` · ${voice.progress}%` : '…'}</p>
          <div style={{ background: 'var(--theme-elevation-100)', borderRadius: 2, height: 4, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ background: 'var(--vs-accent)', height: '100%', transition: 'width .4s', width: `${Math.max(2, voice.progress ?? 0)}%` }} />
          </div>
        </div>
      ) : (
        <ReadyVoice base={base} busy={busy} onDelete={remove} voice={voice} />
      )}
      {error && voice && <p style={{ ...muted, color: 'var(--theme-error-500)', marginTop: 8 }}>{error}</p>}
    </div>
  )
}

const ReadyVoice: React.FC<{ base: string; busy: boolean; onDelete: () => void; voice: SpeakerFieldData }> = ({ base, busy, onDelete, voice }) => {
  const call = useAPI()
  const [langs, setLangs] = useState<Languages>()
  const [lang, setLang] = useState('en')
  const [src, setSrc] = useState<string>()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string>()
  const audio = useRef<HTMLAudioElement>(null)
  const { serverURL, api } = useAPIBase()

  useEffect(() => {
    call<Languages>('/vocalstack/languages').then(setLangs, (err) => setError(err.message))
  }, [call])

  /** The preview is made on first ask (202): ask until it is there, then play it. */
  const play = async () => {
    setError(undefined)
    setWaiting(true)
    const url = `${serverURL}${api}${base}/preview?${new URLSearchParams({ format: previewFormat(), lang })}`
    try {
      for (let i = 0; i < 20; i++) {
        const res = await fetch(url, { credentials: 'include' })
        if (res.status === 202) {
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Preview failed (${res.status})`)
        setSrc(URL.createObjectURL(await res.blob()))
        requestAnimationFrame(() => void audio.current?.play().catch(() => undefined))
        return
      }
      throw new Error('The preview is taking a while; try again in a minute.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWaiting(false)
    }
  }

  const names = new Map(langs?.languages.map((l) => [l.code, l.name]))
  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={muted}>Ready{voice.sampleS ? `, cloned from ${Math.round(voice.sampleS)} s of speech` : ''}. Translations are read in this voice.</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <select aria-label="Preview language" onChange={(e) => setLang(e.target.value)} value={lang}>
          {(langs?.voice ?? ['en']).map((code) => (
            <option key={code} value={code}>
              {names.get(code) ?? code}
            </option>
          ))}
        </select>
        <Button buttonStyle="secondary" disabled={waiting} margin={false} onClick={play} size="small">
          {waiting ? 'Making…' : '▶ Hear'}
        </Button>
      </div>
      {src && <audio controls ref={audio} src={src} style={{ width: '100%' }} />}
      {error && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
      <div>
        <Button buttonStyle="error" disabled={busy} margin={false} onClick={onDelete} size="small">
          Delete speaker
        </Button>
      </div>
    </div>
  )
}

const CreateVoice: React.FC<{
  base: string
  name: string
  onCancel: () => void
  onCreated: (res: SpeakerAnswer) => void
}> = ({ base, name, onCancel, onCreated }) => {
  const call = useAPI()
  const { serverURL, api } = useAPIBase()
  const [tab, setTab] = useState<'file' | 'recording' | 'record'>('recording')
  const [sources, setSources] = useState<SpeakerSource[]>()
  const [file, setFile] = useState<File>()
  const [fileS, setFileS] = useState<number>()
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    call<{ sources: SpeakerSource[] }>(`${base}/sources`).then(
      (r) => {
        setSources(r.sources)
        if (!r.sources.length) setTab('record')
      },
      (err) => setError(err.message),
    )
  }, [base, call])

  const longEnough = (fileS ?? 0) >= MIN_S - 1.5

  const pick = (f: File | undefined) => {
    setFile(f)
    setFileS(undefined)
    if (!f) return
    // Measure it: VocalStack needs at least 30 s.
    const a = new Audio(URL.createObjectURL(f))
    a.onloadedmetadata = () => setFileS(a.duration)
  }

  const switchTo = (next: typeof tab) => {
    setTab(next)
    setFile(undefined)
    setFileS(undefined)
    setError(undefined)
  }

  /** A recorded or uploaded sample: sent through the server to VocalStack. */
  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError(undefined)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('_payload', JSON.stringify({ consent }))
      const r = await fetch(`${serverURL}${api}${base}`, { body: form, credentials: 'include', method: 'POST' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? (r.status === 413 ? 'The sample is too large; use a shorter or compressed file.' : `Request failed (${r.status})`))
      toast.success('Voice created. It is training now.')
      onCreated(body)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  const tabs = [
    ['recording', 'From a sermon'],
    ['record', 'Record'],
    ['file', 'Upload'],
  ] as const

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="vs-voice-tabs">
        {tabs.map(([key, label]) => (
          <Button buttonStyle={tab === key ? 'primary' : 'secondary'} key={key} margin={false} onClick={() => switchTo(key)} size="small">
            {label}
          </Button>
        ))}
      </div>

      {tab === 'recording' ? (
        !sources ? (
          <p style={muted}>{error ? '' : 'Looking for transcribed recordings…'}</p>
        ) : !sources.length ? (
          <p style={muted}>No transcribed recordings of {name || 'them'} yet. Transcribe one, or record a sample.</p>
        ) : (
          <VoiceFromRecording base={base} name={name} onCreated={onCreated} sources={sources} />
        )
      ) : (
        <>
          {tab === 'record' ? (
            <RecordSample
              onRecorded={(f, seconds) => {
                setFile(f)
                setFileS(seconds)
              }}
            />
          ) : (
            <>
              <p style={muted}>
                {MIN_S} s to 2 min of {name || 'them'} speaking alone, clearly, with no music. An MP3 or M4A of about a minute is ideal.
              </p>
              <input accept="audio/*" onChange={(e) => pick(e.target.files?.[0])} type="file" />
            </>
          )}
          {file && fileS !== undefined && !longEnough && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>That is {Math.round(fileS)} s; at least {MIN_S} s is needed.</p>}
          <label style={{ alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }}>
            <input checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} type="checkbox" />
            <span>I have {name || 'their'}&rsquo;s permission to clone their voice.</span>
          </label>
          {error && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
          <div>
            <Button disabled={busy || !consent || !longEnough || !file} margin={false} onClick={upload} size="small">
              {busy ? 'Creating…' : 'Create voice'}
            </Button>
          </div>
        </>
      )}
      <div>
        <Button buttonStyle="secondary" disabled={busy} margin={false} onClick={onCancel} size="small">
          Cancel
        </Button>
      </div>
    </div>
  )
}

function useAPIBase() {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  return { api, serverURL }
}
