'use client'

import { Button, toast, useConfig, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { StatusResponse, TranscriptSentence, TranscriptWord, VocalStackFieldData } from '../types.js'

import { BrandStyles, Logo } from './Brand.js'
import { useConnection } from './useConnection.js'

// Only when the live stream is unavailable.
const POLL_MS = 3000

/** 2433.0 → "40:33", 4000 → "1:06:40". */
const clock = (s: number) => {
  const t = Math.floor(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`
}

const PHASES: Record<string, string> = {
  extracting: 'Extracting audio',
  fetching: 'Fetching the file',
  queued: 'Queued',
  transcribing: 'Transcribing',
}

type Props = {
  /** Set when the button sits in a row of this array field (`audioFields`). */
  field?: string
  oneClickConnect?: boolean
  path?: string
}

export const TranscribeButton: React.FC<Props> = ({ field, oneClickConnect, path = '' }) => {
  const { id, collectionSlug } = useDocumentInfo()
  // `attachments.3.vocalstackTranscribe` → `attachments.3.`; on an upload document, nothing.
  const prefix = path.replace(/vocalstackTranscribe$/, '')
  const rowId = useFormFields(([fields]) => (field ? fields[`${prefix}id`]?.value : undefined)) as string | undefined
  const query = field ? `?${new URLSearchParams({ field, row: rowId ?? '' })}` : ''
  const {
    config: {
      routes: { admin, api },
      serverURL,
    },
  } = useConfig()
  const { dispatchFields } = useForm()
  const status = useFormFields(([fields]) => fields[`${prefix}vocalstack.status`]?.value) as string | undefined
  const savedError = useFormFields(([fields]) => fields[`${prefix}vocalstack.error`]?.value) as string | undefined
  const language = useFormFields(([fields]) => fields[`${prefix}vocalstack.language`]?.value) as string | undefined
  const { call, connect, connecting, connection } = useConnection()

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<Pick<StatusResponse, 'audio'> & { pct?: number; phase?: string }>({})
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const source = useRef<EventSource>(undefined)
  // The job as it is heard: settled sentences by id, and the words after them.
  const live = useRef({ draft: [] as TranscriptWord[], sentences: new Map<number, TranscriptSentence>() })
  const frame = useRef<number>(undefined)

  // Write the server's copy into the form as its saved state, so a later Save keeps it.
  const apply = useCallback(
    (data: VocalStackFieldData | undefined) => {
      for (const [key, value] of Object.entries(data ?? {})) {
        dispatchFields({ type: 'UPDATE', initialValue: value, path: `${prefix}vocalstack.${key}`, value })
      }
    },
    [dispatchFields, prefix],
  )

  // Hand the live sentences to the transcript view, at most once a frame, as the field's
  // saved value so the form stays clean. Unchanged sentences keep their identity.
  const publish = useCallback(() => {
    frame.current ??= requestAnimationFrame(() => {
      frame.current = undefined
      const { draft, sentences } = live.current
      const list = [...sentences.values()].sort((a, b) => a.start - b.start)
      if (draft.length) {
        list.push({ draft: true, end: draft[draft.length - 1][1], speaker: list.at(-1)?.speaker ?? 0, start: draft[0][0], text: draft.map((w) => w[2]).join(' '), words: draft })
      }
      dispatchFields({ type: 'UPDATE', initialValue: list, path: `${prefix}vocalstack.sentences`, value: list })
    })
  }, [dispatchFields, prefix])

  const resetLive = useCallback(
    (sentences: TranscriptSentence[] = []) => {
      live.current = { draft: [], sentences: new Map(sentences.map((s, i) => [s.id ?? -1 - i, s])) }
      publish()
    },
    [publish],
  )

  const finish = useCallback(
    (res: StatusResponse) => {
      // A live update still waiting for its frame must not land on top of the result.
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = undefined
      apply(res.vocalstack)
      setBusy(false)
      if (res.stopped) toast.info('Transcription stopped.')
      else if (res.status === 'done') toast.success('Transcript ready.')
      if (res.status === 'failed') setError(res.error)
    },
    [apply],
  )

  const poll = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const res = await call<StatusResponse>(`/${collectionSlug}/${id}/vocalstack/status${query}`)
      if (res.status === 'processing') {
        setProgress({ audio: res.audio, pct: res.progress, phase: res.phase })
        if (res.partial) resetLive(res.partial)
        timer.current = setTimeout(poll, POLL_MS)
        return
      }
      finish(res)
    } catch (err) {
      // A network blip should not end the wait; anything VocalStack refused should.
      if ((err as { code?: string }).code) {
        setBusy(false)
        setError((err as Error).message)
      } else timer.current = setTimeout(poll, POLL_MS * 2)
    }
  }, [call, collectionSlug, finish, id, query, resetLive])

  /** Follow the job live: progress, then the words as they are recognized, then the saved result. */
  const follow = useCallback(() => {
    source.current?.close()
    const es = new EventSource(`${serverURL}${api}/${collectionSlug}/${id}/vocalstack/stream${query}`, { withCredentials: true })
    source.current = es
    es.addEventListener('progress', (e) => {
      const res = JSON.parse(e.data) as StatusResponse
      setProgress({ audio: res.audio, pct: res.progress, phase: res.phase })
    })
    es.addEventListener('snapshot', (e) => resetLive((JSON.parse(e.data) as { sentences: TranscriptSentence[] }).sentences))
    es.addEventListener('sentence', (e) => {
      const data = JSON.parse(e.data) as { id?: number; removed?: boolean; sentence?: TranscriptSentence }
      if (data.removed && data.id !== undefined) live.current.sentences.delete(data.id)
      else if (data.sentence?.id !== undefined) live.current.sentences.set(data.sentence.id, data.sentence)
      publish()
    })
    es.addEventListener('draft', (e) => {
      live.current.draft = (JSON.parse(e.data) as { words: TranscriptWord[] }).words
      publish()
    })
    for (const outcome of ['done', 'failed', 'stopped']) {
      es.addEventListener(outcome, (e) => {
        es.close()
        source.current = undefined
        finish(JSON.parse((e as MessageEvent).data) as StatusResponse)
      })
    }
    // EventSource retries dropped connections itself; it gives up only when the answer was not a
    // stream (the job is already over, or VocalStack refused): ask once, then poll if need be.
    es.onerror = () => {
      if (es.readyState !== EventSource.CLOSED) return
      source.current = undefined
      void poll()
    }
  }, [api, collectionSlug, finish, id, poll, publish, query, resetLive, serverURL])

  // Pick a running job back up after a reload. The saved sentences are the previous
  // transcript, not this job's, so start blank until the stream catches up.
  useEffect(() => {
    if (status === 'processing' && id && !source.current && !timer.current) {
      setBusy(true)
      resetLive()
      follow()
    }
  }, [follow, id, resetLive, status])
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      source.current?.close()
      if (frame.current) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const transcribe = async () => {
    setError(undefined)
    setBusy(true)
    setProgress({})
    resetLive()
    try {
      const res = await call<StatusResponse>(`/${collectionSlug}/${id}/vocalstack/transcribe${query}`, { method: 'POST' })
      // The server still holds the previous transcript (it is replaced once this job is
      // done); take only the job's fields, or the old text flashes up until the stream starts.
      const { sentences: _previous, transcript: _text, ...job } = res.vocalstack ?? {}
      apply(job)
      follow()
    } catch (err) {
      setBusy(false)
      setError((err as Error).message)
    }
  }

  const [stopping, setStopping] = useState(false)
  /** Stop the job. The field goes back to how it was; VocalStack keeps what it heard so far. */
  const stop = async () => {
    if (!window.confirm('Stop transcribing? What VocalStack has transcribed so far stays in your VocalStack dashboard.')) return
    setStopping(true)
    try {
      const res = await call<StatusResponse>(`/${collectionSlug}/${id}/vocalstack/stop${query}`, { method: 'POST' })
      if (res.status === 'processing') return
      source.current?.close()
      source.current = undefined
      clearTimeout(timer.current)
      timer.current = undefined
      finish(res)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setStopping(false)
    }
  }

  const shownError = error ?? (status === 'failed' ? savedError : undefined)

  return (
    <div className="field-type vs-brand" style={{ marginBottom: 'var(--base)' }}>
      <BrandStyles />
      <div className="field-label" style={{ marginBottom: 'calc(var(--base) / 2)' }}>
        <Logo height={14} />
      </div>
      {!id ? (
        <p style={{ color: 'var(--theme-elevation-500)', margin: 0 }}>Save first, then transcribe.</p>
      ) : connection && !connection.connected ? (
        oneClickConnect ? (
          <Button buttonStyle="secondary" disabled={connecting} margin={false} onClick={() => connect().catch((e) => setError(e.message))} size="medium">
            {connecting ? 'Waiting for VocalStack…' : 'Connect VocalStack'}
          </Button>
        ) : (
          <Button buttonStyle="secondary" el="link" margin={false} size="medium" to={`${admin}/globals/vocalstack`}>
            Connect VocalStack
          </Button>
        )
      ) : (
        <Button disabled={busy || !connection} margin={false} onClick={transcribe} size="medium">
          {busy ? 'Transcribing…' : status === 'done' ? 'Transcribe again' : 'Transcribe'}
        </Button>
      )}

      {busy && (
        <div style={{ marginTop: 'calc(var(--base) / 2)' }}>
          <div style={{ color: 'var(--theme-elevation-500)', fontSize: 13 }}>
            {PHASES[progress.phase ?? 'queued'] ?? progress.phase}
            {progress.pct ? ` · ${progress.pct}%` : '…'}
            {progress.audio?.totalS ? ` · ${clock(progress.audio.processedS)} of ${clock(progress.audio.totalS)}` : ''}
          </div>
          <div style={{ background: 'var(--theme-elevation-100)', borderRadius: 2, height: 4, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ background: 'var(--vs-accent)', height: '100%', transition: 'width .4s', width: `${progress.pct ?? 2}%` }} />
          </div>
          <div style={{ marginTop: 'calc(var(--base) / 2)' }}>
            <Button buttonStyle="secondary" disabled={stopping} margin={false} onClick={stop} size="small">
              {stopping ? 'Stopping…' : 'Stop'}
            </Button>
          </div>
        </div>
      )}
      {!busy && status === 'done' && !shownError && (
        <p style={{ color: 'var(--theme-elevation-500)', fontSize: 13, margin: 'calc(var(--base) / 2) 0 0' }}>
          Transcribed{language ? ` (${language})` : ''}. Play the audio to follow along in the transcript.
        </p>
      )}
      {shownError && <p style={{ color: 'var(--theme-error-500)', fontSize: 13, margin: 'calc(var(--base) / 2) 0 0' }}>{shownError}</p>}
    </div>
  )
}
