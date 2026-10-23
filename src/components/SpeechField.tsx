'use client'

import { Button, toast, useConfig, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Languages, VoiceOption } from '../api.js'
import type { Speech, SpeechResponse, TranscriptSentence, Translation, VocalStackFieldData } from '../types.js'

import { BrandStyles } from './Brand.js'
import { useAPI } from './useConnection.js'

const POLL_MS = 5000

const styles = `
  .vs-speech { border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 4px); padding: 12px 16px; margin-top: 12px; }
  .vs-speech h4 { margin: 0 0 8px; font-size: 14px; }
  .vs-speech-row { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 2.4fr) auto; gap: 10px; align-items: center; padding: 8px 0;
    border-top: 1px solid var(--theme-elevation-100); font-size: 13px; }
  .vs-speech-row:first-of-type { border-top: 0; }
  .vs-speech-muted { color: var(--theme-elevation-500); font-size: 13px; margin: 0; }
  .vs-speech-error { color: var(--theme-error-500); font-size: 13px; margin: 0; }
  .vs-speech select, .vs-speech input[type=search] { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--theme-elevation-150);
    border-radius: var(--style-radius-s, 4px); background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); max-width: 100%; }
  .vs-speech audio { height: 32px; width: 100%; }
  .vs-speech-langs { columns: 3 160px; max-height: 200px; overflow-y: auto; margin: 8px 0; font-size: 13px; }
  .vs-speech-langs label { display: flex; gap: 6px; align-items: center; break-inside: avoid; padding: 2px 0; }
  .vs-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--theme-elevation-200); border-top-color: var(--vs-accent);
    border-radius: 50%; animation: vs-spin .8s linear infinite; margin-right: 6px; vertical-align: -1px; }
  @keyframes vs-spin { to { transform: rotate(360deg); } }
  .vs-bar { position: relative; height: 4px; border-radius: 2px; overflow: hidden; background: var(--theme-elevation-100); }
  .vs-bar span { position: absolute; inset: 0 auto 0 0; min-width: 6%; border-radius: 2px; background: var(--vs-accent); transition: width .6s ease-out; }
  .vs-bar span::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);
    animation: vs-sweep 1.4s ease-in-out infinite; }
  @keyframes vs-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .vs-spin, .vs-bar span::after { animation: none; } }
`

const TRANSLATING = 'Translating…'

type Props = { field?: string; path?: string }

/** Translations of the transcript, and readings of them aloud: under the transcript once it is done. */
export const SpeechField: React.FC<Props> = ({ field, path = '' }) => {
  const { id, collectionSlug } = useDocumentInfo()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const call = useAPI()
  const { dispatchFields } = useForm()
  // `attachments.3.vocalstack.vocalstackSpeech` → the group, and the row it is in.
  const group = path.replace(/vocalstackSpeech$/, '')
  const rowPrefix = group.replace(/vocalstack\.$/, '')
  const rowId = useFormFields(([fields]) => (field ? fields[`${rowPrefix}id`]?.value : undefined)) as string | undefined
  const query = field ? `?${new URLSearchParams({ field, row: rowId ?? '' })}` : ''
  const withQuery = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(field ? { field, row: rowId ?? '' } : {}), ...extra })}`
  const translations = (useFormFields(([fields]) => fields[`${group}translations`]?.value) ?? {}) as Record<string, Translation>
  const speech = (useFormFields(([fields]) => fields[`${group}speech`]?.value) ?? {}) as Record<string, Speech>
  const spoken = useFormFields(([fields]) => fields[`${group}language`]?.value) as string | undefined
  const recordingId = useFormFields(([fields]) => fields[`${group}recordingId`]?.value) as string | undefined
  // As the server counts them: settled, numbered sentences with text.
  const total = useFormFields(
    ([fields]) => ((fields[`${group}sentences`]?.value ?? []) as TranscriptSentence[]).filter((s) => !s.draft && s.id !== undefined && s.text.trim()).length,
  ) as number

  const [langs, setLangs] = useState<Languages>()
  const [defaultVoice, setDefaultVoice] = useState<null | string>(null)
  const [voices, setVoices] = useState<Record<string, VoiceOption[]>>({})
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const base = `/${collectionSlug}/${id}/vocalstack`

  // The server saved these; make them the form's saved state too, so Save keeps them.
  const apply = useCallback(
    (data: VocalStackFieldData | undefined) => {
      for (const key of ['translations', 'speech'] as const) {
        if (data && key in data) dispatchFields({ type: 'UPDATE', initialValue: data[key], path: `${group}${key}`, value: data[key] })
      }
    },
    [dispatchFields, group],
  )

  const busySpeech = Object.values(speech).some((s) => s.state === 'queued' || s.state === 'running')

  const check = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const res = await call<SpeechResponse>(`${base}/speak${query}`)
      setDefaultVoice(res.defaultVoice ?? null)
      apply(res.vocalstack)
      const before = speech
      for (const [lang, s] of Object.entries(res.vocalstack.speech ?? {})) {
        if (s.state === 'sealed' && before[lang]?.state !== 'sealed') toast.success(`The ${lang.toUpperCase()} reading is ready.`)
      }
      setError(undefined)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [apply, base, call, query, speech])

  useEffect(() => {
    if (!id) return
    call<Languages>('/vocalstack/languages').then(setLangs, (err) => setError(err.message))
    void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rowId])

  // Poll while a reading is being made.
  useEffect(() => {
    if (busySpeech) timer.current = setTimeout(check, POLL_MS)
    return () => clearTimeout(timer.current)
  }, [busySpeech, check, speech])

  const loadVoices = useCallback(
    (lang: string) => {
      if (voices[lang]) return
      setVoices((v) => ({ ...v, [lang]: [] }))
      call<{ voices: VoiceOption[] }>(`/vocalstack/voices?${new URLSearchParams({ lang, ...(recordingId ? { recording: recordingId } : {}) })}`).then(
        (r) => setVoices((v) => ({ ...v, [lang]: r.voices })),
        () => undefined,
      )
    },
    [call, recordingId, voices],
  )

  const names = useMemo(() => new Map(langs?.languages.map((l) => [l.code, l.name])), [langs])
  const canSpeak = useMemo(() => new Set(langs?.voice), [langs])
  // Languages being added show up straight away, with their progress.
  const shown = [...new Set([...Object.keys(translations), ...Object.keys(speech), ...Object.keys(working)])].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b))
  const speakable = shown.filter((l) => canSpeak.has(l)).join()
  useEffect(() => {
    for (const l of speakable.split(',')) if (l) loadVoices(l)
  }, [loadVoices, speakable])

  /** Translate until done (each call stops after a while and says whether there is more). */
  const translate = async (list: string[]) => {
    if (!list.length) return
    for (;;) {
      const res = await call<SpeechResponse>(`${base}/translate${query}`, { body: JSON.stringify({ langs: list }), method: 'POST' })
      apply(res.vocalstack)
      if (!res.more) break
    }
    toast.success(`Translated into ${list.map((l) => names.get(l) ?? l).join(', ')}.`)
  }

  const run = async (list: string[], label: string, job: () => Promise<void>) => {
    if (!list.length) return
    setError(undefined)
    setWorking((w) => ({ ...w, ...Object.fromEntries(list.map((l) => [l, label])) }))
    try {
      await job()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setWorking((w) => Object.fromEntries(Object.entries(w).filter(([l]) => !list.includes(l))))
    }
  }

  const speak = (list: string[], voice?: string) =>
    run(list, TRANSLATING, async () => {
      await translate(list.filter((l) => !translations[l]))
      setWorking((w) => ({ ...w, ...Object.fromEntries(list.map((l) => [l, 'Asking VocalStack to read it aloud…'])) }))
      const res = await call<SpeechResponse>(`${base}/speak${query}`, { body: JSON.stringify({ langs: list, voice: voice || undefined }), method: 'POST' })
      apply(res.vocalstack)
      setDefaultVoice(res.defaultVoice ?? null)
    })

  const remove = (lang: string) =>
    window.confirm(`Remove the ${names.get(lang) ?? lang} translation${speech[lang] ? ' and its reading' : ''}?`) &&
    run([lang], 'Removing…', async () => {
      apply((await call<SpeechResponse>(`${base}/translate${withQuery({ lang })}`, { method: 'DELETE' })).vocalstack)
    })

  const voiceName = (lang: string, key: null | string | undefined) => {
    if (!key) return 'VocalStack’s default voice'
    return voices[lang]?.find((v) => v.id === key)?.name ?? (key.startsWith('clone:') ? 'a cloned voice' : key)
  }

  if (!id) return null

  return (
    <div className="vs-brand vs-speech">
      <BrandStyles />
      <style>{styles}</style>
      <h4>Translations and readings</h4>
      {!shown.length && <p className="vs-speech-muted">Translate the transcript so listeners can read along, or hear it read aloud, in their language.</p>}
      {shown.map((lang) => {
        const t = translations[lang]
        const s = speech[lang]
        const busy = working[lang]
        const voicesHere = voices[lang] ?? []
        return (
          <div className="vs-speech-row" key={lang}>
            <div>
              <strong>{names.get(lang) ?? lang}</strong>
              <p className="vs-speech-muted">
                {t && t.sentences.length < total ? `${t.sentences.length} of ${total} sentences translated` : t ? `${t.sentences.length} sentences translated` : busy === TRANSLATING ? 'Starting…' : 'Not translated'}
              </p>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {busy === TRANSLATING ? (
                <Progress done={t?.sentences.length ?? 0} label={TRANSLATING} total={total} />
              ) : busy ? (
                <span className="vs-speech-muted">
                  <span className="vs-spin" />
                  {busy}
                </span>
              ) : s?.state === 'queued' || s?.state === 'running' ? (
                <Progress
                  done={s.done ?? 0}
                  label={`${s.state === 'queued' ? 'Waiting to be read aloud…' : 'Being read aloud…'} (${voiceName(lang, s.voice)})`}
                  since={s.requestedAt}
                  total={t?.sentences.length ?? 0}
                />
              ) : s?.state === 'sealed' ? (
                <>
                  <audio
                    controls
                    key={s.renderedAt ?? ''}
                    preload="none"
                    src={`${serverURL}${api}${base}/audio${withQuery({ lang, v: s.renderedAt ?? '' })}`}
                  />
                  <span className="vs-speech-muted">Read by {voiceName(lang, s.voice)}</span>
                </>
              ) : s?.state === 'failed' ? (
                <p className="vs-speech-error">Reading failed: {s.error ?? 'no reason given'}</p>
              ) : !canSpeak.has(lang) ? (
                <span className="vs-speech-muted">VocalStack cannot read {names.get(lang) ?? lang} aloud yet.</span>
              ) : null}
              {canSpeak.has(lang) && !busy && s?.state !== 'queued' && s?.state !== 'running' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <select aria-label="Voice" onChange={(e) => setPicked((p) => ({ ...p, [lang]: e.target.value }))} value={picked[lang] ?? ''}>
                    <option value="">Default for this recording ({voiceName(lang, defaultVoice)})</option>
                    {voicesHere.map((v) => (
                      <option disabled={v.ready === false && v.cloned} key={v.id} value={v.id}>
                        {v.name}
                        {v.cloned ? ' (cloned)' : ''}
                      </option>
                    ))}
                  </select>
                  <Button buttonStyle="secondary" margin={false} onClick={() => speak([lang], picked[lang])} size="small">
                    {s ? 'Read again' : 'Read aloud'}
                  </Button>
                </div>
              )}
            </div>
            <Button buttonStyle="secondary" disabled={Boolean(busy)} margin={false} onClick={() => remove(lang)} size="small">
              Remove
            </Button>
          </div>
        )
      })}
      <AddLanguages
        busy={Object.keys(working).length > 0}
        canSpeak={canSpeak}
        exclude={new Set([...shown, ...(spoken ? [spoken] : [])])}
        langs={langs}
        onSpeak={(list) => speak(list)}
        onTranslate={(list) => run(list, TRANSLATING, () => translate(list))}
      />
      {error && <p className="vs-speech-error">{error}</p>}
    </div>
  )
}

/** Work under way: the share of sentences done, counted up as each step is saved, and the time it has taken. */
const Progress: React.FC<{ done: number; label: string; since?: string; total: number }> = ({ done, label, since, total }) => {
  const [started] = useState(() => (since ? new Date(since).getTime() : Date.now()))
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - started) / 1000))
  const elapsed = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  done = Math.min(done, total)
  const share = total ? done / total : 0
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div aria-valuemax={total} aria-valuemin={0} aria-valuenow={done} className="vs-bar" role="progressbar">
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <span className="vs-speech-muted">
        <span className="vs-spin" />
        {label} {total ? `${done} of ${total} sentences` : ''} · {elapsed}
      </span>
    </div>
  )
}

const AddLanguages: React.FC<{
  busy: boolean
  canSpeak: Set<string>
  exclude: Set<string>
  langs?: Languages
  onSpeak: (langs: string[]) => Promise<void>
  onTranslate: (langs: string[]) => Promise<void>
}> = ({ busy, canSpeak, exclude, langs, onSpeak, onTranslate }) => {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  if (!langs) return null
  const options = langs.languages
    .filter((l) => l.translation && !exclude.has(l.code))
    .filter((l) => !filter || `${l.name} ${l.native} ${l.code}`.toLowerCase().includes(filter.toLowerCase()))
  const go = async (fn: (l: string[]) => Promise<void>) => {
    const list = chosen
    setChosen([])
    setOpen(false)
    await fn(list)
  }
  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <Button buttonStyle="secondary" disabled={busy} margin={false} onClick={() => setOpen(true)} size="small">
          Add languages
        </Button>
      </div>
    )
  }
  // A reading is at most a few languages at a time.
  const speakable = chosen.filter((l) => canSpeak.has(l))
  return (
    <div style={{ borderTop: '1px solid var(--theme-elevation-100)', marginTop: 10, paddingTop: 10 }}>
      <input onChange={(e) => setFilter(e.target.value)} placeholder="Find a language" type="search" value={filter} />
      <div className="vs-speech-langs">
        {options.map((l) => (
          <label key={l.code}>
            <input
              checked={chosen.includes(l.code)}
              onChange={(e) => setChosen((c) => (e.target.checked ? [...c, l.code] : c.filter((x) => x !== l.code)))}
              type="checkbox"
            />
            {l.name}
            {canSpeak.has(l.code) ? ' 🔊' : ''}
          </label>
        ))}
      </div>
      <p className="vs-speech-muted" style={{ marginBottom: 8 }}>
        🔊 can also be read aloud. Translating a long recording takes a few minutes.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button disabled={busy || !chosen.length} margin={false} onClick={() => go(onTranslate)} size="small">
          Translate
        </Button>
        <Button
          disabled={busy || !speakable.length || speakable.length > 3}
          margin={false}
          onClick={() => go(async (list) => {
            await onTranslate(list.filter((l) => !canSpeak.has(l)))
            await onSpeak(list.filter((l) => canSpeak.has(l)))
          })}
          size="small"
        >
          {speakable.length > 3 ? 'Read aloud: 3 at a time' : 'Translate and read aloud'}
        </Button>
        <Button buttonStyle="secondary" margin={false} onClick={() => setOpen(false)} size="small">
          Cancel
        </Button>
      </div>
    </div>
  )
}
