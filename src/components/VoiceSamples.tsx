'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Languages } from '../api.js'
import type { TranscriptSentence, VoiceFieldData, VoiceSource } from '../types.js'

import { useAPI } from './useConnection.js'

/** As in the VocalStack dashboard: at least 5 s makes a voice, 20 s a steadier one, 25 s is plenty; 60 s at most. */
export const PICK_MIN_S = 5
const PICK_GOOD_S = 20
const PICK_TARGET_S = 25
const PICK_MAX_S = 60

export const sampleStyles = `
  .vs-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 4px; }
  .vs-step { border-top: 3px solid var(--theme-elevation-150); padding-top: 6px; font-size: 12px; color: var(--theme-elevation-500); }
  .vs-step--on { border-color: var(--vs-accent); color: var(--theme-text); font-weight: 600; }
  .vs-step--done { border-color: color-mix(in srgb, var(--vs-accent) 45%, transparent); }
  .vs-sample { border: 1px solid var(--theme-elevation-150); border-radius: 8px; overflow: hidden; }
  .vs-sample-body { padding: 10px 12px; display: grid; gap: 8px; }
  .vs-sample-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--theme-elevation-500); }
  .vs-sample-text { font-size: 14px; line-height: 1.45; min-height: 2.9em; }
  .vs-sample-play { display: flex; align-items: center; gap: 10px; }
  .vs-play { width: 34px; height: 34px; flex: none; border-radius: 50%; border: 0; background: var(--vs-accent); color: #fff; cursor: pointer; font-size: 12px; }
  .vs-play:disabled { opacity: .5; cursor: default; }
  .vs-wave { flex: 1; display: flex; align-items: center; gap: 2px; height: 28px; min-width: 0; }
  .vs-wave span { flex: 1; border-radius: 1px; background: var(--theme-elevation-250); }
  .vs-wave span.on { background: var(--vs-accent); }
  .vs-sample-use { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--theme-elevation-150);
    background: var(--theme-elevation-50); font-size: 14px; cursor: pointer; }
  .vs-pager { display: flex; gap: 4px; }
  .vs-pager button { border: 0; background: none; color: var(--theme-text); cursor: pointer; font-size: 16px; padding: 0 6px; }
  .vs-pager button:disabled { opacity: .3; cursor: default; }
  .vs-meter { position: relative; height: 6px; border-radius: 3px; background: var(--theme-elevation-100); overflow: hidden; }
  .vs-meter span { position: absolute; inset: 0 auto 0 0; background: var(--vs-accent); transition: width .3s; }
  .vs-meter-marks { position: relative; height: 16px; font-size: 11px; color: var(--theme-elevation-500); }
  .vs-meter-marks span { position: absolute; transform: translateX(-50%); }
  .vs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .vs-chip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--theme-elevation-150); border-radius: 12px; padding: 2px 4px 2px 10px; font-size: 12px; }
  .vs-chip button { border: 0; background: none; cursor: pointer; color: var(--theme-elevation-500); }
  .vs-chips--none { border: 1px dashed var(--theme-elevation-200); border-radius: 12px; padding: 4px 10px; font-size: 12px; color: var(--theme-elevation-500); }
`

type Clip = { end: number; start: number; text: string }
type Trial = { error?: null | string; id: string; key: string; progress?: number; state: string }

const secs = (c: Clip) => Math.max(0, c.end - c.start)
const TERMINAL = /[.!?…。！？।؟;]["'”’»)\]]*$/

/** The sentences of the one who speaks most in the recording: the person whose voice this is. */
function candidates(sentences: TranscriptSentence[]): { clips: Clip[]; speaker: number } {
  const bySpeaker = new Map<number, number>()
  for (const s of sentences) if (s.speaker >= 0) bySpeaker.set(s.speaker, (bySpeaker.get(s.speaker) ?? 0) + (s.end - s.start))
  const speaker = [...bySpeaker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const clips = sentences.filter((s) => s.speaker === speaker && s.end > s.start && s.text.trim()).map((s) => ({ end: s.end, start: s.start, text: s.text.trim() }))
  return { clips, speaker }
}

/** The clearest picks first, as the dashboard ranks them: whole sentences of 4–11 s, about 8 s best. */
function chooseFor(clips: Clip[]): Set<number> {
  const tier = (c: Clip) => (!TERMINAL.test(c.text) ? 2 : secs(c) >= 4 && secs(c) <= 11 ? 0 : 1)
  const near = (c: Clip) => -Math.abs(secs(c) - 8)
  const order = clips.map((c, i) => i).sort((a, b) => tier(clips[a]) - tier(clips[b]) || near(clips[b]) - near(clips[a]) || a - b)
  const out = new Set<number>()
  let total = 0
  for (const i of order) {
    if (total + 0.05 >= PICK_TARGET_S) break
    if (total + secs(clips[i]) > PICK_MAX_S + 0.5) continue
    out.add(i)
    total += secs(clips[i])
  }
  return out
}

const pickedSeconds = (clips: Clip[], picked: Set<number>) => [...picked].reduce((t, i) => t + (clips[i] ? secs(clips[i]) : 0), 0)
const spansOf = (clips: Clip[], picked: Set<number>) =>
  [...picked]
    .filter((i) => clips[i])
    .sort((a, b) => clips[a].start - clips[b].start)
    .map((i) => ({ end: clips[i].end, start: clips[i].start }))

function useBase() {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  return `${serverURL}${api}`
}

/** One sentence of the recording: its waveform, and a play button. */
const SampleAudio: React.FC<{ src: string }> = ({ src }) => {
  const [bars, setBars] = useState<number[]>()
  const [url, setUrl] = useState<string>()
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    let gone = false
    let made: string | undefined
    setBars(undefined)
    setUrl(undefined)
    setFailed(false)
    setAt(0)
    setPlaying(false)
    fetch(src, { credentials: 'include' })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r)))
      .then((wav) => {
        if (gone) return
        // 16-bit PCM after the 44-byte header: the peak of each stretch, as a bar.
        const pcm = new Int16Array(wav, 44, Math.max(0, (wav.byteLength - 44) >> 1))
        const n = 40
        const per = Math.max(1, Math.floor(pcm.length / n))
        const peaks = Array.from({ length: n }, (_, i) => {
          let p = 0
          for (let k = i * per; k < Math.min((i + 1) * per, pcm.length); k++) p = Math.max(p, Math.abs(pcm[k]))
          return p
        })
        const top = Math.max(1, ...peaks)
        setBars(peaks.map((p) => 14 + (p / top) * 86))
        made = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
        setUrl(made)
      })
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [src])

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }
  const duration = audio.current?.duration || 0
  const share = duration ? at / duration : 0

  return (
    <div className="vs-sample-play">
      <button aria-label={playing ? 'Pause' : 'Play'} className="vs-play" disabled={!url} onClick={toggle} type="button">
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="vs-wave">
        {failed ? (
          <span style={{ background: 'none', color: 'var(--theme-elevation-500)', fontSize: 12 }}>Could not load this sample.</span>
        ) : (
          (bars ?? Array.from({ length: 40 }, () => 14)).map((h, i, all) => <span className={i / all.length < share ? 'on' : ''} key={i} style={{ height: `${h}%` }} />)
        )}
      </div>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{`00:${String(Math.round(duration - at || 0)).padStart(2, '0')}`}</span>
      {url && (
        <audio
          onEnded={() => {
            setPlaying(false)
            setAt(0)
          }}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
          ref={audio}
          src={url}
        />
      )}
    </div>
  )
}

/**
 * Clone a voice from sentences of one of the person's own transcribed recordings, as in the
 * VocalStack dashboard: pick samples (or have them chosen), hear the voice, then name and keep it.
 */
export const VoiceFromRecording: React.FC<{
  base: string
  name: string
  onCreated: (res: { name?: string; vocalstackVoice: VoiceFieldData }) => void
  sources: VoiceSource[]
}> = ({ base, name, onCreated, sources }) => {
  const call = useAPI()
  const apiBase = useBase()
  const [sourceIdx, setSourceIdx] = useState(0)
  const source = sources[sourceIdx]
  const { clips, speaker } = useMemo(() => candidates(source?.sentences ?? []), [source])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [trial, setTrial] = useState<Trial>()
  const [voiceName, setVoiceName] = useState(name)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const kept = useRef(false)
  const trialId = useRef<string>(undefined)
  trialId.current = trial?.id

  // A trial voice nobody kept is deleted when the panel closes.
  useEffect(
    () => () => {
      if (trialId.current && !kept.current) void call(`${base}/trial?${new URLSearchParams({ voice: trialId.current })}`, { method: 'DELETE' }).catch(() => undefined)
    },
    [base, call],
  )

  // Follow the trial voice while it trains.
  useEffect(() => {
    if (!trial || (trial.state !== 'training' && trial.state !== 'queued')) return
    const t = setTimeout(() => {
      call<{ voice: Omit<Trial, 'key'> }>(`${base}/trial?${new URLSearchParams({ voice: trial.id })}`).then(
        (r) => setTrial((cur) => (cur?.id === r.voice.id ? { ...cur, ...r.voice } : cur)),
        () => undefined,
      )
    }, 2000)
    return () => clearTimeout(t)
  }, [base, call, trial])

  const total = pickedSeconds(clips, picked)
  const pickKey = JSON.stringify(spansOf(clips, picked))
  const clip = clips[Math.min(idx, clips.length - 1)]
  const here = picked.has(idx)
  const room = here || (clip && total + secs(clip) <= PICK_MAX_S + 0.5)
  const enough = total + 0.05 >= PICK_MIN_S && total <= PICK_MAX_S + 0.5
  const best = useMemo(() => chooseFor(clips), [clips])
  const chosen = best.size > 0 && best.size === picked.size && [...best].every((i) => picked.has(i))

  const toggle = (i: number) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(i)) next.delete(i)
      else if (clips[i] && pickedSeconds(clips, p) + secs(clips[i]) <= PICK_MAX_S + 0.5) next.add(i)
      return next
    })

  /** Step 2: make a trial voice from the picked samples (a new one when the picks changed). */
  const tryVoice = async () => {
    setStep(2)
    if (trial && trial.key === pickKey && trial.state !== 'failed') return
    setBusy(true)
    setError(undefined)
    try {
      const r = await call<{ voice: Omit<Trial, 'key'> }>(`${base}/trial`, {
        body: JSON.stringify({ recordingId: source.recordingId, replace: trial?.id, spans: spansOf(clips, picked), speaker }),
        method: 'POST',
      })
      setTrial({ ...r.voice, key: pickKey })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const keep = async () => {
    if (!trial) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await call<{ name?: string; vocalstackVoice: VoiceFieldData }>(`${base}/trial/keep`, {
        body: JSON.stringify({ consent, name: voiceName, voice: trial.id }),
        method: 'POST',
      })
      kept.current = true
      toast.success('Voice saved.')
      onCreated(res)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  const scale = PICK_TARGET_S * 1.2
  const meterAt = (s: number) => `${Math.min(100, (s / scale) * 100)}%`
  const steps = ['Pick samples', 'Hear the voice', 'Name and save']

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <style>{sampleStyles}</style>
      <div className="vs-steps">
        {steps.map((label, i) => (
          <div className={`vs-step${step === i + 1 ? ' vs-step--on' : step > i + 1 ? ' vs-step--done' : ''}`} key={label}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          {sources.length > 1 && (
            <select
              aria-label="Recording"
              onChange={(e) => {
                setSourceIdx(Number(e.target.value))
                setIdx(0)
                setPicked(new Set())
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
          <div style={{ alignItems: 'baseline', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            <p style={muted}>Pick about {PICK_TARGET_S}s of clear speech, with no music or other voices.</p>
            <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              {Math.round(total)}s <span style={{ color: 'var(--theme-elevation-500)', fontWeight: 400 }}>/ {PICK_TARGET_S}s</span>
            </strong>
          </div>
          <div>
            <Button buttonStyle="secondary" disabled={chosen || !clips.length} margin={false} onClick={() => setPicked(new Set(best))} size="small">
              ✨ Choose for me
            </Button>
          </div>
          {clip ? (
            <div className="vs-sample">
              <div className="vs-sample-body">
                <div className="vs-sample-head">
                  <span>
                    Sample {idx + 1} of {clips.length}
                  </span>
                  <span className="vs-pager">
                    <button aria-label="Previous sample" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))} type="button">
                      ‹
                    </button>
                    <button aria-label="Next sample" disabled={idx >= clips.length - 1} onClick={() => setIdx((i) => Math.min(clips.length - 1, i + 1))} type="button">
                      ›
                    </button>
                  </span>
                </div>
                <div className="vs-sample-text">{clip.text}</div>
                <SampleAudio
                  src={`${apiBase}${base}/clip?${new URLSearchParams({ endS: clip.end.toFixed(2), recording: source.recordingId, startS: clip.start.toFixed(2) })}`}
                />
              </div>
              <label className="vs-sample-use" style={{ opacity: room ? 1 : 0.5 }}>
                <input checked={here} disabled={!room} onChange={() => toggle(idx)} type="checkbox" />
                {room ? 'Use this sample' : `Full: ${PICK_MAX_S}s at most`}
              </label>
            </div>
          ) : (
            <p style={muted}>No sentences of theirs in this recording.</p>
          )}
          <div>
            <div className="vs-meter">
              <span style={{ width: meterAt(total) }} />
            </div>
            <div className="vs-meter-marks">
              {[PICK_MIN_S, PICK_GOOD_S, PICK_TARGET_S].map((s) => (
                <span key={s} style={{ fontWeight: total + 0.05 >= s ? 600 : 400, left: meterAt(s) }}>
                  {s}s
                </span>
              ))}
            </div>
          </div>
          <p style={muted}>
            {!picked.size
              ? `At least ${PICK_MIN_S}s makes a voice.`
              : total + 0.05 < PICK_MIN_S
                ? `${Math.ceil(PICK_MIN_S - total)}s more to make a voice.`
                : total >= PICK_TARGET_S
                  ? 'Plenty.'
                  : total + 0.05 < PICK_GOOD_S
                    ? `Enough for a voice. ${PICK_GOOD_S}s or more sounds steadier.`
                    : `Good. About ${PICK_TARGET_S}s gives it more to choose from.`}
          </p>
          {picked.size ? (
            <div className="vs-chips">
              {[...picked]
                .sort((a, b) => a - b)
                .map((i) => (
                  <span className="vs-chip" key={i}>
                    <button onClick={() => setIdx(i)} style={{ color: 'inherit', padding: 0 }} type="button">
                      {i + 1} · {Math.round(secs(clips[i]))}s
                    </button>
                    <button aria-label={`Leave sample ${i + 1} out`} onClick={() => toggle(i)} type="button">
                      ✕
                    </button>
                  </span>
                ))}
            </div>
          ) : (
            <span className="vs-chips--none">No samples picked yet</span>
          )}
          <div>
            <Button disabled={!enough || busy} margin={false} onClick={tryVoice} size="small">
              Next
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {!trial || trial.state === 'training' || trial.state === 'queued' ? (
            <p style={muted}>Making the voice{trial?.progress ? ` · ${trial.progress}%` : '…'} It takes a minute or two.</p>
          ) : trial.state === 'failed' ? (
            <p style={{ ...muted, color: 'var(--theme-error-500)' }}>The voice could not be made: {trial.error ?? 'no reason given'}. Pick other samples.</p>
          ) : (
            <TrialPreview base={base} voice={trial.id} />
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Button buttonStyle="secondary" margin={false} onClick={() => setStep(1)} size="small">
              Back
            </Button>
            <Button disabled={trial?.state !== 'ready'} margin={false} onClick={() => setStep(3)} size="small">
              Next
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <label style={{ display: 'grid', fontSize: 13, gap: 4 }}>
            Name
            <input maxLength={60} onChange={(e) => setVoiceName(e.target.value)} style={{ font: 'inherit', padding: '6px 8px' }} value={voiceName} />
          </label>
          <label style={{ alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }}>
            <input checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} type="checkbox" />
            <span>I have {name || 'their'}&rsquo;s permission to clone their voice.</span>
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button buttonStyle="secondary" disabled={busy} margin={false} onClick={() => setStep(2)} size="small">
              Back
            </Button>
            <Button disabled={busy || !consent || !voiceName.trim()} margin={false} onClick={keep} size="small">
              {busy ? 'Saving…' : 'Save voice'}
            </Button>
          </div>
        </>
      )}
      {error && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
    </div>
  )
}

/** Ogg/Opus where the browser plays it, else CAF (Safari). */
const previewFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'caf')

/** The trial voice speaking a few seconds, in a language picked. */
const TrialPreview: React.FC<{ base: string; voice: string }> = ({ base, voice }) => {
  const call = useAPI()
  const apiBase = useBase()
  const [langs, setLangs] = useState<Languages>()
  const [lang, setLang] = useState('en')
  const [src, setSrc] = useState<string>()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string>()
  const audio = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    call<Languages>('/vocalstack/languages').then(setLangs, () => undefined)
  }, [call])

  const play = async () => {
    setError(undefined)
    setWaiting(true)
    const url = `${apiBase}${base}/trial/preview?${new URLSearchParams({ format: previewFormat(), lang, voice })}`
    try {
      for (let i = 0; i < 30; i++) {
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
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }}>Hear it before you keep it. Not right? Go back and pick other samples.</p>
      <div style={{ display: 'flex', gap: 6 }}>
        <select aria-label="Preview language" onChange={(e) => setLang(e.target.value)} value={lang}>
          {(langs?.voice ?? ['en']).map((code) => (
            <option key={code} value={code}>
              {names.get(code) ?? code}
            </option>
          ))}
        </select>
        <Button buttonStyle="secondary" disabled={waiting} margin={false} onClick={play} size="small">
          {waiting ? 'Making…' : '▶ Hear the voice'}
        </Button>
      </div>
      {src && <audio controls ref={audio} src={src} style={{ width: '100%' }} />}
      {error && <p style={{ color: 'var(--theme-error-500)', fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  )
}

/** Record them speaking, in the browser, as the sample to clone from. */
export const RecordSample: React.FC<{ onRecorded: (file: File | undefined, seconds: number | undefined) => void }> = ({ onRecorded }) => {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const rec = useRef<MediaRecorder>(undefined)
  const started = useRef(0)

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250)
    return () => clearInterval(t)
  }, [recording])

  const start = async () => {
    setError(undefined)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const chunks: Blob[] = []
      const r = new MediaRecorder(stream)
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = r.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type })
        const seconds = (Date.now() - started.current) / 1000
        setUrl(URL.createObjectURL(blob))
        onRecorded(new File([blob], `recording.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`, { type }), seconds)
      }
      rec.current = r
      started.current = Date.now()
      setElapsed(0)
      setUrl(undefined)
      onRecorded(undefined, undefined)
      r.start(1000)
      setRecording(true)
    } catch {
      setError('The microphone could not be used. Allow it for this site, or upload a sample instead.')
    }
  }
  const stop = () => {
    rec.current?.stop()
    setRecording(false)
  }

  const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={muted}>Record them reading or speaking naturally for 30 seconds to a minute, alone, in a quiet room.</p>
      <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <Button buttonStyle={recording ? 'error' : 'primary'} margin={false} onClick={recording ? stop : start} size="small">
          {recording ? '■ Stop' : url ? '● Record again' : '● Record'}
        </Button>
        {(recording || url) && <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{`${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`}</span>}
      </div>
      {url && !recording && <audio controls src={url} style={{ width: '100%' }} />}
      {error && <p style={{ ...muted, color: 'var(--theme-error-500)' }}>{error}</p>}
    </div>
  )
}
