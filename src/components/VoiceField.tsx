'use client'

import { Button, toast, useConfig, useDocumentInfo, useForm } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Languages } from '../api.js'
import type { TranscriptSentence, VoiceFieldData, VoiceSource } from '../types.js'

import { BrandStyles, Logo } from './Brand.js'
import { useAPI, useConnection } from './useConnection.js'

const POLL_MS = 3000
const TARGET_S = 60
const MIN_S = 30
const MAX_S = 120

const styles = `
  .vs-voice-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 4px);
    background: var(--theme-input-bg, var(--theme-elevation-0)); font-size: 13px; line-height: 1.5; }
  .vs-voice-line { display: flex; gap: 8px; width: 100%; padding: 6px 10px; border: 0; background: none; color: inherit; text-align: left; cursor: pointer; font: inherit; }
  .vs-voice-line:hover { background: var(--theme-elevation-50); }
  .vs-voice-line--in { background: color-mix(in srgb, var(--vs-accent) 14%, transparent); }
  .vs-voice-line--start { box-shadow: inset 3px 0 0 var(--vs-accent); }
  .vs-voice-time { color: var(--theme-elevation-500); font-variant-numeric: tabular-nums; flex: none; }
  .vs-voice-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .vs-voice select, .vs-voice input[type=file] { width: 100%; font: inherit; }
  .vs-voice select { padding: 6px 8px; border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 4px);
    background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); }
`

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Whole sentences from `start`, about a minute of them: VocalStack clones from 30–120 s. */
function stretchFrom(sentences: TranscriptSentence[], start: number): { endS: number; ids: Set<number | undefined>; startS: number } {
  const from = sentences[start]
  const ids = new Set<number | undefined>()
  let endS = from.end
  for (let i = start; i < sentences.length; i++) {
    const s = sentences[i]
    if (s.end - from.start > MAX_S) break
    ids.add(s.id)
    endS = s.end
    if (endS - from.start >= TARGET_S) break
  }
  return { endS, ids, startS: from.start }
}

/** Ogg/Opus where the browser plays it, else CAF (Safari). */
const previewFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'caf')

export const VoiceField: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo()
  const { dispatchFields } = useForm()
  const { connection } = useConnection()
  const call = useAPI()
  const base = `/${collectionSlug}/${id}/vocalstack/voice`

  const [voice, setVoice] = useState<VoiceFieldData>()
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Keep the form's copy in step with the server's, so saving the document keeps the voice.
  const apply = useCallback(
    (res: { name?: string; vocalstackVoice: VoiceFieldData }) => {
      setVoice(res.vocalstackVoice)
      if (res.name) setName(res.name)
      for (const [key, value] of Object.entries(res.vocalstackVoice)) {
        dispatchFields({ type: 'UPDATE', initialValue: value, path: `vocalstackVoice.${key}`, value })
      }
    },
    [dispatchFields],
  )

  const refresh = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const res = await call<{ name: string; vocalstackVoice: VoiceFieldData }>(base)
      apply(res)
      setError(undefined)
      if (res.vocalstackVoice.state === 'training') timer.current = setTimeout(refresh, POLL_MS)
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
    if (!window.confirm(`Delete ${name || 'this'} voice? Readings already made with it stay as they are.`)) return
    setBusy(true)
    try {
      apply(await call(base, { method: 'DELETE' }))
      toast.success('Voice deleted.')
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
        <Logo height={14} /> <span>Voice</span>
      </div>
      {!id ? (
        <p style={muted}>Save first, then create a voice.</p>
      ) : connection && !connection.connected ? (
        <p style={muted}>Connect VocalStack (Settings → VocalStack) to create a voice.</p>
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

const ReadyVoice: React.FC<{ base: string; busy: boolean; onDelete: () => void; voice: VoiceFieldData }> = ({ base, busy, onDelete, voice }) => {
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
          Delete voice
        </Button>
      </div>
    </div>
  )
}

const CreateVoice: React.FC<{
  base: string
  name: string
  onCancel: () => void
  onCreated: (res: { name?: string; vocalstackVoice: VoiceFieldData }) => void
}> = ({ base, name, onCancel, onCreated }) => {
  const call = useAPI()
  const { serverURL, api } = useAPIBase()
  const [tab, setTab] = useState<'file' | 'recording'>('recording')
  const [sources, setSources] = useState<VoiceSource[]>()
  const [sourceIdx, setSourceIdx] = useState(0)
  const [start, setStart] = useState<number>()
  const [file, setFile] = useState<File>()
  const [fileS, setFileS] = useState<number>()
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    call<{ sources: VoiceSource[] }>(`${base}/sources`).then(
      (r) => {
        setSources(r.sources)
        if (!r.sources.length) setTab('file')
      },
      (err) => setError(err.message),
    )
  }, [base, call])

  const source = sources?.[sourceIdx]
  const sentences = useMemo(() => source?.sentences ?? [], [source])
  const stretch = start !== undefined && sentences[start] ? stretchFrom(sentences, start) : undefined
  const length = stretch ? stretch.endS - stretch.startS : tab === 'file' ? fileS : undefined
  const longEnough = (length ?? 0) >= MIN_S - 1.5

  const pick = (f: File | undefined) => {
    setFile(f)
    setFileS(undefined)
    if (!f) return
    // Measure it: VocalStack needs at least 30 s.
    const a = new Audio(URL.createObjectURL(f))
    a.onloadedmetadata = () => setFileS(a.duration)
  }

  const create = async () => {
    setBusy(true)
    setError(undefined)
    try {
      let res: { name?: string; vocalstackVoice: VoiceFieldData }
      if (tab === 'recording' && source && stretch) {
        res = await call(base, { body: JSON.stringify({ consent, endS: stretch.endS, recordingId: source.recordingId, startS: stretch.startS }), method: 'POST' })
      } else if (file) {
        const form = new FormData()
        form.append('file', file)
        form.append('_payload', JSON.stringify({ consent }))
        const r = await fetch(`${serverURL}${api}${base}`, { body: form, credentials: 'include', method: 'POST' })
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error ?? (r.status === 413 ? 'The sample is too large; use a shorter or compressed file.' : `Request failed (${r.status})`))
        res = body
      } else return
      toast.success('Voice created. It is training now.')
      onCreated(res)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  const clipURL = stretch && source ? `${serverURL}${api}${base}/clip?${new URLSearchParams({ endS: String(stretch.endS), recording: source.recordingId, startS: String(stretch.startS) })}` : undefined

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="vs-voice-tabs">
        <Button buttonStyle={tab === 'recording' ? 'primary' : 'secondary'} margin={false} onClick={() => setTab('recording')} size="small">
          From a recording
        </Button>
        <Button buttonStyle={tab === 'file' ? 'primary' : 'secondary'} margin={false} onClick={() => setTab('file')} size="small">
          Upload a sample
        </Button>
      </div>

      {tab === 'recording' ? (
        !sources ? (
          <p style={muted}>{error ? '' : 'Looking for transcribed recordings…'}</p>
        ) : !sources.length ? (
          <p style={muted}>No transcribed recordings of {name || 'them'} yet. Transcribe one, or upload a sample.</p>
        ) : (
          <>
            {sources.length > 1 && (
              <select
                aria-label="Recording"
                onChange={(e) => {
                  setSourceIdx(Number(e.target.value))
                  setStart(undefined)
                }}
                value={sourceIdx}
              >
                {sources.map((s, i) => (
                  <option key={s.recordingId} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <p style={muted}>Click where {name || 'they'} start speaking alone, with no music or other voices. About a minute is taken from there.</p>
            <div className="vs-voice-list">
              {sentences.map((s, i) => (
                <button
                  className={`vs-voice-line${stretch?.ids.has(s.id) ? ' vs-voice-line--in' : ''}${i === start ? ' vs-voice-line--start' : ''}`}
                  key={s.id ?? i}
                  onClick={() => setStart(i)}
                  type="button"
                >
                  <span className="vs-voice-time">{clock(s.start)}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
            {stretch && (
              <>
                <p style={muted}>
                  {clock(stretch.startS)}–{clock(stretch.endS)} · {Math.round(stretch.endS - stretch.startS)} s{longEnough ? '' : ` (at least ${MIN_S} s needed)`}
                </p>
                <audio controls key={clipURL} preload="none" src={clipURL} style={{ width: '100%' }} />
              </>
            )}
          </>
        )
      ) : (
        <>
          <p style={muted}>
            {MIN_S} s to 2 min of {name || 'them'} speaking alone, clearly, with no music. An MP3 or M4A of about a minute is ideal.
          </p>
          <input accept="audio/*" onChange={(e) => pick(e.target.files?.[0])} type="file" />
          {file && fileS !== undefined && !longEnough && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>That is {Math.round(fileS)} s; at least {MIN_S} s is needed.</p>}
        </>
      )}

      <label style={{ alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }}>
        <input checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} type="checkbox" />
        <span>I have {name || 'their'}&rsquo;s permission to clone their voice.</span>
      </label>

      {error && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 6 }}>
        <Button disabled={busy || !consent || !longEnough || (tab === 'file' ? !file : !stretch)} margin={false} onClick={create} size="small">
          {busy ? 'Creating…' : 'Create voice'}
        </Button>
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
