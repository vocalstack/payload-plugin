'use client'

import { Button, toast, useConfig, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Languages } from '../api.js'
import type { Speech, SpeechResponse, TranscriptSentence, Translation, VocalStackFieldData, VoiceMode } from '../types.js'

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
  .vs-speech-voices { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin: 4px 0; font-size: 13px; }
  .vs-speech-voices label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
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
/** The most languages one recording may have, besides its spoken one (VocalStack's limit). */
const LANGUAGE_LIMIT = 10

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
  const toggled = ((useFormFields(([fields]) => fields[`${group}voices`]?.value) as string | undefined) ?? 'synthetic') as VoiceMode
  // Decided by the site (e.g. the speaker's own setting), when the server says so.
  const [decided, setDecided] = useState<SpeechResponse['voiceMode']>()
  const voices: VoiceMode = decided?.fixed ? decided.mode : toggled
  // As the server counts them: settled, numbered sentences with text.
  const total = useFormFields(
    ([fields]) => ((fields[`${group}sentences`]?.value ?? []) as TranscriptSentence[]).filter((s) => !s.draft && s.id !== undefined && s.text.trim()).length,
  ) as number

  const [langs, setLangs] = useState<Languages>()
  const [working, setWorking] = useState<Record<string, string>>({})
  const [error, setError] = useState<string>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const base = `/${collectionSlug}/${id}/vocalstack`

  // The server saved these; make them the form's saved state too, so Save keeps them.
  const apply = useCallback(
    (data: VocalStackFieldData | undefined) => {
      for (const key of ['translations', 'speech', 'voices'] as const) {
        if (data && key in data) dispatchFields({ type: 'UPDATE', initialValue: data[key], path: `${group}${key}`, value: data[key] })
      }
    },
    [dispatchFields, group],
  )

  // Work the server carries on with: readings being made, and translations (and the readings waiting for them).
  const busySpeech =
    Object.values(speech).some((s) => s.state === 'queued' || s.state === 'running' || s.state === 'translating') ||
    Object.values(translations).some((t) => t.pending)

  const check = useCallback(async () => {
    clearTimeout(timer.current)
    try {
      const res = await call<SpeechResponse>(`${base}/speak${query}`)
      if (res.voiceMode) setDecided(res.voiceMode)
      apply(res.vocalstack)
      const before = speech
      for (const [lang, s] of Object.entries(res.vocalstack.speech ?? {})) {
        if (s.state === 'sealed' && before[lang]?.state !== 'sealed') toast.success(`The ${lang.toUpperCase()} reading is ready.`)
      }
      for (const [lang, t] of Object.entries(res.vocalstack.translations ?? {})) {
        if (!t.pending && translations[lang]?.pending && !t.error) toast.success(`The ${lang.toUpperCase()} translation is ready.`)
      }
      setError(undefined)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [apply, base, call, query, speech, translations])

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

  const names = useMemo(() => new Map(langs?.languages.map((l) => [l.code, l.name])), [langs])
  const canSpeak = useMemo(() => new Set(langs?.voice), [langs])
  // Languages being added show up straight away, with their progress.
  const shown = [...new Set([...Object.keys(translations), ...Object.keys(speech), ...Object.keys(working)])].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b))

  /** Add languages: the server translates them and, with `speak`, reads them aloud, with no one watching. */
  const request = async (list: string[], speak: boolean) => {
    const res = await call<SpeechResponse>(`${base}/request${query}`, { body: JSON.stringify({ langs: list, speak }), method: 'POST' })
    apply(res.vocalstack)
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

  // VocalStack picks the voice.
  const speak = (list: string[]) =>
    run(list, 'Asking VocalStack to read it aloud…', async () => {
      const res = await call<SpeechResponse>(`${base}/speak${query}`, { body: JSON.stringify({ langs: list }), method: 'POST' })
      apply(res.vocalstack)
    })

  const [switching, setSwitching] = useState(false)
  const setVoices = async (next: VoiceMode) => {
    if (next === voices) return
    setSwitching(true)
    setError(undefined)
    try {
      apply((await call<SpeechResponse>(`${base}/voices${query}`, { body: JSON.stringify({ voices: next }), method: 'POST' })).vocalstack)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSwitching(false)
    }
  }

  const remove = (lang: string) =>
    window.confirm(`Remove the ${names.get(lang) ?? lang} translation${speech[lang] ? ' and its reading' : ''}?`) &&
    run([lang], 'Removing…', async () => {
      apply((await call<SpeechResponse>(`${base}/translate${withQuery({ lang })}`, { method: 'DELETE' })).vocalstack)
    })

  if (!id) return null

  return (
    <div className="vs-brand vs-speech">
      <BrandStyles />
      <style>{styles}</style>
      <h4>Translations and readings</h4>
      {decided?.fixed ? (
        <p className="vs-speech-muted" style={{ marginBottom: 8 }}>
          Read aloud in <strong>{voices === 'cloned' ? 'cloned voices' : 'synthetic voices'}</strong>, as set for the person speaking.
          {voices === 'cloned' ? ' Where they have no cloned voice yet, a synthetic one reads.' : ''}
        </p>
      ) : (
        <>
          <div className="vs-speech-voices" role="radiogroup" aria-label="Voices">
            <span className="vs-speech-muted">Read aloud in</span>
            {(['synthetic', 'cloned'] as const).map((mode) => (
              <label key={mode}>
                <input checked={voices === mode} disabled={switching} name={`${group}voices-mode`} onChange={() => setVoices(mode)} type="radio" />
                {mode === 'synthetic' ? 'Synthetic voices' : 'Cloned voices'}
              </label>
            ))}
          </div>
          <p className="vs-speech-muted" style={{ marginBottom: 8 }}>
            {voices === 'cloned'
              ? 'Each speaker is read in their own cloned voice where they have one (made with their permission), otherwise in a synthetic one.'
              : 'Readings use VocalStack’s synthetic voices.'}{' '}
            Applies to readings made from now on; read a language again to change one already made.
          </p>
        </>
      )}
      {!shown.length && <p className="vs-speech-muted">Translate the transcript so listeners can read along, or hear it read aloud, in their language.</p>}
      {shown.map((lang) => {
        const t = translations[lang]
        const s = speech[lang]
        const busy = working[lang]
        return (
          <div className="vs-speech-row" key={lang}>
            <div>
              <strong>{names.get(lang) ?? lang}</strong>
              <p className="vs-speech-muted">
                {t?.pending
                  ? 'Translating…'
                  : t?.error && !t.sentences.length
                    ? 'Not translated'
                    : t && t.sentences.length < total
                      ? `${t.sentences.length} of ${total} sentences translated`
                      : t
                        ? `${t.sentences.length} sentences translated`
                        : 'Not translated'}
              </p>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {t?.pending ? (
                <>
                  <Progress done={t.sentences.length} label={TRANSLATING} since={t.requestedAt ?? undefined} total={total} />
                  {s?.state === 'translating' && <span className="vs-speech-muted">Read aloud once translated.</span>}
                  {t.error && <span className="vs-speech-muted">{t.error} Trying again shortly.</span>}
                </>
              ) : busy ? (
                <span className="vs-speech-muted">
                  <span className="vs-spin" />
                  {busy}
                </span>
              ) : s?.state === 'queued' || s?.state === 'running' ? (
                <Progress
                  done={s.done ?? 0}
                  label={s.state === 'queued' ? 'Waiting to be read aloud…' : 'Being read aloud…'}
                  since={s.requestedAt}
                  total={t?.sentences.length ?? 0}
                />
              ) : s?.state === 'sealed' ? (
                <audio
                  controls
                  key={s.renderedAt ?? ''}
                  preload="none"
                  src={`${serverURL}${api}${base}/audio${withQuery({ lang, v: s.renderedAt ?? '' })}`}
                />
              ) : t?.error && !t.sentences.length ? (
                <p className="vs-speech-error">Translating failed: {t.error}</p>
              ) : s?.state === 'translating' ? (
                <span className="vs-speech-muted">
                  <span className="vs-spin" />
                  Waiting for VocalStack to read it aloud…
                </span>
              ) : s?.state === 'failed' ? (
                <p className="vs-speech-error">Reading failed: {s.error ?? 'no reason given'}</p>
              ) : !canSpeak.has(lang) ? (
                <span className="vs-speech-muted">VocalStack cannot read {names.get(lang) ?? lang} aloud yet.</span>
              ) : null}
              {canSpeak.has(lang) && !busy && !t?.pending && (!s || s.state === 'failed' || (s.state === 'sealed' && (s.cast ?? 'synthetic') !== voices)) && (
                <div>
                  <Button buttonStyle="secondary" margin={false} onClick={() => speak([lang])} size="small">
                    {!s ? 'Read aloud' : s.state === 'failed' ? 'Try again' : `Read again in ${voices} voices`}
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
        left={LANGUAGE_LIMIT - shown.filter((l) => l !== spoken).length}
        onAdd={(list, speakToo) => run(list, 'Starting…', () => request(list, speakToo))}
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
  /** How many more languages this recording may have. */
  left: number
  onAdd: (langs: string[], speak: boolean) => Promise<void>
}> = ({ busy, canSpeak, exclude, langs, left, onAdd }) => {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  if (!langs) return null
  if (left <= 0) {
    return (
      <p className="vs-speech-muted" style={{ marginTop: 10 }}>
        This recording has {LANGUAGE_LIMIT} languages, as many as one recording may have. Remove one to add another.
      </p>
    )
  }
  const options = langs.languages
    .filter((l) => l.translation && !exclude.has(l.code))
    .filter((l) => !filter || `${l.name} ${l.native} ${l.code}`.toLowerCase().includes(filter.toLowerCase()))
  const go = async (speak: boolean) => {
    const list = chosen
    setChosen([])
    setOpen(false)
    await onAdd(list, speak)
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
  const tooMany = chosen.length > left
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
      <p className={tooMany ? 'vs-speech-error' : 'vs-speech-muted'} style={{ marginBottom: 8 }}>
        🔊 is read aloud too. {left} more language{left === 1 ? '' : 's'} can be added ({LANGUAGE_LIMIT} at most per recording). VocalStack carries on
        translating and reading after you leave this page.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Button disabled={busy || !chosen.length || tooMany} margin={false} onClick={() => go(true)} size="small">
          Translate and read aloud
        </Button>
        <Button buttonStyle="secondary" disabled={busy || !chosen.length || tooMany} margin={false} onClick={() => go(false)} size="small">
          Translate only
        </Button>
        <Button buttonStyle="secondary" margin={false} onClick={() => setOpen(false)} size="small">
          Cancel
        </Button>
      </div>
    </div>
  )
}
