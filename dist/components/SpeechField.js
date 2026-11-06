'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, toast, useConfig, useDocumentInfo, useForm, useFormFields } from '@payloadcms/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandStyles } from './Brand.js';
import { useAPI } from './useConnection.js';
const POLL_MS = 5000;
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
`;
const TRANSLATING = 'Translating…';
/** The most languages one recording may have, besides its spoken one (VocalStack's limit). */
const LANGUAGE_LIMIT = 10;
/** Translations of the transcript, and readings of them aloud: under the transcript once it is done. */
export const SpeechField = ({ field, path = '' }) => {
    const { id, collectionSlug } = useDocumentInfo();
    const { config: { routes: { api }, serverURL, }, } = useConfig();
    const call = useAPI();
    const { dispatchFields } = useForm();
    // `attachments.3.vocalstack.vocalstackSpeech` → the group, and the row it is in.
    const group = path.replace(/vocalstackSpeech$/, '');
    const rowPrefix = group.replace(/vocalstack\.$/, '');
    const rowId = useFormFields(([fields]) => (field ? fields[`${rowPrefix}id`]?.value : undefined));
    const query = field ? `?${new URLSearchParams({ field, row: rowId ?? '' })}` : '';
    const withQuery = (extra) => `?${new URLSearchParams({ ...(field ? { field, row: rowId ?? '' } : {}), ...extra })}`;
    const translations = (useFormFields(([fields]) => fields[`${group}translations`]?.value) ?? {});
    const speech = (useFormFields(([fields]) => fields[`${group}speech`]?.value) ?? {});
    const spoken = useFormFields(([fields]) => fields[`${group}language`]?.value);
    const toggled = (useFormFields(([fields]) => fields[`${group}voices`]?.value) ?? 'synthetic');
    // Decided by the site (e.g. the speaker's own setting), when the server says so.
    const [decided, setDecided] = useState();
    const voices = decided?.fixed ? decided.mode : toggled;
    // As the server counts them: settled, numbered sentences with text.
    const total = useFormFields(([fields]) => (fields[`${group}sentences`]?.value ?? []).filter((s) => !s.draft && s.id !== undefined && s.text.trim()).length);
    const [langs, setLangs] = useState();
    const [working, setWorking] = useState({});
    const [error, setError] = useState();
    const timer = useRef(undefined);
    const base = `/${collectionSlug}/${id}/vocalstack`;
    // The server saved these; make them the form's saved state too, so Save keeps them.
    const apply = useCallback((data) => {
        for (const key of ['translations', 'speech', 'voices']) {
            if (data && key in data)
                dispatchFields({ type: 'UPDATE', initialValue: data[key], path: `${group}${key}`, value: data[key] });
        }
    }, [dispatchFields, group]);
    // Work the server carries on with: readings being made, and translations (and the readings waiting for them).
    const busySpeech = Object.values(speech).some((s) => s.state === 'queued' || s.state === 'running' || s.state === 'translating') ||
        Object.values(translations).some((t) => t.pending);
    const check = useCallback(async () => {
        clearTimeout(timer.current);
        try {
            const res = await call(`${base}/speak${query}`);
            if (res.voiceMode)
                setDecided(res.voiceMode);
            apply(res.vocalstack);
            const before = speech;
            for (const [lang, s] of Object.entries(res.vocalstack.speech ?? {})) {
                if (s.state === 'sealed' && before[lang]?.state !== 'sealed')
                    toast.success(`The ${lang.toUpperCase()} reading is ready.`);
            }
            for (const [lang, t] of Object.entries(res.vocalstack.translations ?? {})) {
                if (!t.pending && translations[lang]?.pending && !t.error)
                    toast.success(`The ${lang.toUpperCase()} translation is ready.`);
            }
            setError(undefined);
        }
        catch (err) {
            setError(err.message);
        }
    }, [apply, base, call, query, speech, translations]);
    useEffect(() => {
        if (!id)
            return;
        call('/vocalstack/languages').then(setLangs, (err) => setError(err.message));
        void check();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, rowId]);
    // Poll while a reading is being made.
    useEffect(() => {
        if (busySpeech)
            timer.current = setTimeout(check, POLL_MS);
        return () => clearTimeout(timer.current);
    }, [busySpeech, check, speech]);
    const names = useMemo(() => new Map(langs?.languages.map((l) => [l.code, l.name])), [langs]);
    const canSpeak = useMemo(() => new Set(langs?.voice), [langs]);
    // Languages being added show up straight away, with their progress.
    const shown = [...new Set([...Object.keys(translations), ...Object.keys(speech), ...Object.keys(working)])].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    /** Add languages: the server translates them and, with `speak`, reads them aloud, with no one watching. */
    const request = async (list, speak) => {
        const res = await call(`${base}/request${query}`, { body: JSON.stringify({ langs: list, speak }), method: 'POST' });
        apply(res.vocalstack);
    };
    const run = async (list, label, job) => {
        if (!list.length)
            return;
        setError(undefined);
        setWorking((w) => ({ ...w, ...Object.fromEntries(list.map((l) => [l, label])) }));
        try {
            await job();
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setWorking((w) => Object.fromEntries(Object.entries(w).filter(([l]) => !list.includes(l))));
        }
    };
    // VocalStack picks the voice.
    const speak = (list) => run(list, 'Asking VocalStack to read it aloud…', async () => {
        const res = await call(`${base}/speak${query}`, { body: JSON.stringify({ langs: list }), method: 'POST' });
        apply(res.vocalstack);
    });
    const [switching, setSwitching] = useState(false);
    const setVoices = async (next) => {
        if (next === voices)
            return;
        setSwitching(true);
        setError(undefined);
        try {
            apply((await call(`${base}/voices${query}`, { body: JSON.stringify({ voices: next }), method: 'POST' })).vocalstack);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setSwitching(false);
        }
    };
    const remove = (lang) => window.confirm(`Remove the ${names.get(lang) ?? lang} translation${speech[lang] ? ' and its reading' : ''}?`) &&
        run([lang], 'Removing…', async () => {
            apply((await call(`${base}/translate${withQuery({ lang })}`, { method: 'DELETE' })).vocalstack);
        });
    if (!id)
        return null;
    return (_jsxs("div", { className: "vs-brand vs-speech", children: [_jsx(BrandStyles, {}), _jsx("style", { children: styles }), _jsx("h4", { children: "Translations and readings" }), decided?.fixed ? (_jsxs("p", { className: "vs-speech-muted", style: { marginBottom: 8 }, children: ["Read aloud in ", _jsx("strong", { children: voices === 'cloned' ? 'cloned voices' : 'synthetic voices' }), ", as set for the person speaking.", voices === 'cloned' ? ' Where they have no cloned voice yet, a synthetic one reads.' : ''] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "vs-speech-voices", role: "radiogroup", "aria-label": "Voices", children: [_jsx("span", { className: "vs-speech-muted", children: "Read aloud in" }), ['synthetic', 'cloned'].map((mode) => (_jsxs("label", { children: [_jsx("input", { checked: voices === mode, disabled: switching, name: `${group}voices-mode`, onChange: () => setVoices(mode), type: "radio" }), mode === 'synthetic' ? 'Synthetic voices' : 'Cloned voices'] }, mode)))] }), _jsxs("p", { className: "vs-speech-muted", style: { marginBottom: 8 }, children: [voices === 'cloned'
                                ? 'Each speaker is read in their own cloned voice where they have one (made with their permission), otherwise in a synthetic one.'
                                : 'Readings use VocalStack’s synthetic voices.', ' ', "Applies to readings made from now on; read a language again to change one already made."] })] })), !shown.length && _jsx("p", { className: "vs-speech-muted", children: "Translate the transcript so listeners can read along, or hear it read aloud, in their language." }), shown.map((lang) => {
                const t = translations[lang];
                const s = speech[lang];
                const busy = working[lang];
                return (_jsxs("div", { className: "vs-speech-row", children: [_jsxs("div", { children: [_jsx("strong", { children: names.get(lang) ?? lang }), _jsx("p", { className: "vs-speech-muted", children: t?.pending
                                        ? 'Translating…'
                                        : t?.error && !t.sentences.length
                                            ? 'Not translated'
                                            : t && t.sentences.length < total
                                                ? `${t.sentences.length} of ${total} sentences translated`
                                                : t
                                                    ? `${t.sentences.length} sentences translated`
                                                    : 'Not translated' })] }), _jsxs("div", { style: { display: 'grid', gap: 6 }, children: [t?.pending ? (_jsxs(_Fragment, { children: [_jsx(Progress, { done: t.sentences.length, label: TRANSLATING, since: t.requestedAt ?? undefined, total: total }), s?.state === 'translating' && _jsx("span", { className: "vs-speech-muted", children: "Read aloud once translated." }), t.error && _jsxs("span", { className: "vs-speech-muted", children: [t.error, " Trying again shortly."] })] })) : busy ? (_jsxs("span", { className: "vs-speech-muted", children: [_jsx("span", { className: "vs-spin" }), busy] })) : s?.state === 'queued' || s?.state === 'running' ? (_jsx(Progress, { done: s.done ?? 0, label: s.state === 'queued' ? 'Waiting to be read aloud…' : 'Being read aloud…', since: s.requestedAt, total: t?.sentences.length ?? 0 })) : s?.state === 'sealed' ? (_jsxs(_Fragment, { children: [_jsx("audio", { controls: true, preload: "none", src: `${serverURL}${api}${base}/audio${withQuery({ lang, v: s.renderedAt ?? '' })}` }, s.renderedAt ?? ''), s.cast === 'cloned' && s.readIn === 'mixed' && (_jsx("span", { className: "vs-speech-muted", children: "Some speakers are read in stock voices: they have no cloned voice to use." })), s.cast === 'cloned' && s.readIn === 'synthetic' && (_jsx("span", { className: "vs-speech-muted", children: "Read in stock voices: no speaker has a cloned voice to use." }))] })) : t?.error && !t.sentences.length ? (_jsxs("p", { className: "vs-speech-error", children: ["Translating failed: ", t.error] })) : s?.state === 'translating' ? (_jsxs("span", { className: "vs-speech-muted", children: [_jsx("span", { className: "vs-spin" }), "Waiting for VocalStack to read it aloud\u2026"] })) : s?.state === 'failed' ? (_jsxs("p", { className: "vs-speech-error", children: ["Reading failed: ", s.error ?? 'no reason given'] })) : !canSpeak.has(lang) ? (_jsxs("span", { className: "vs-speech-muted", children: ["VocalStack cannot read ", names.get(lang) ?? lang, " aloud yet."] })) : null, canSpeak.has(lang) && !busy && !t?.pending && (!s || s.state === 'failed' || (s.state === 'sealed' && (s.cast ?? 'synthetic') !== voices)) && (_jsx("div", { children: _jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => speak([lang]), size: "small", children: !s ? 'Read aloud' : s.state === 'failed' ? 'Try again' : `Read again in ${voices} voices` }) }))] }), _jsx(Button, { buttonStyle: "secondary", disabled: Boolean(busy), margin: false, onClick: () => remove(lang), size: "small", children: "Remove" })] }, lang));
            }), _jsx(AddLanguages, { busy: Object.keys(working).length > 0, canSpeak: canSpeak, exclude: new Set([...shown, ...(spoken ? [spoken] : [])]), langs: langs, left: LANGUAGE_LIMIT - shown.filter((l) => l !== spoken).length, onAdd: (list, speakToo) => run(list, 'Starting…', () => request(list, speakToo)) }), error && _jsx("p", { className: "vs-speech-error", children: error })] }));
};
/** Work under way: the share of sentences done, counted up as each step is saved, and the time it has taken. */
const Progress = ({ done, label, since, total }) => {
    const [started] = useState(() => (since ? new Date(since).getTime() : Date.now()));
    const [, tick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, []);
    const s = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const elapsed = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    done = Math.min(done, total);
    const share = total ? done / total : 0;
    return (_jsxs("div", { style: { display: 'grid', gap: 4 }, children: [_jsx("div", { "aria-valuemax": total, "aria-valuemin": 0, "aria-valuenow": done, className: "vs-bar", role: "progressbar", children: _jsx("span", { style: { width: `${share * 100}%` } }) }), _jsxs("span", { className: "vs-speech-muted", children: [_jsx("span", { className: "vs-spin" }), label, " ", total ? `${done} of ${total} sentences` : '', " \u00B7 ", elapsed] })] }));
};
const AddLanguages = ({ busy, canSpeak, exclude, langs, left, onAdd }) => {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [chosen, setChosen] = useState([]);
    if (!langs)
        return null;
    if (left <= 0) {
        return (_jsxs("p", { className: "vs-speech-muted", style: { marginTop: 10 }, children: ["This recording has ", LANGUAGE_LIMIT, " languages, as many as one recording may have. Remove one to add another."] }));
    }
    const options = langs.languages
        .filter((l) => l.translation && !exclude.has(l.code))
        .filter((l) => !filter || `${l.name} ${l.native} ${l.code}`.toLowerCase().includes(filter.toLowerCase()));
    const go = async (speak) => {
        const list = chosen;
        setChosen([]);
        setOpen(false);
        await onAdd(list, speak);
    };
    if (!open) {
        return (_jsx("div", { style: { marginTop: 10 }, children: _jsx(Button, { buttonStyle: "secondary", disabled: busy, margin: false, onClick: () => setOpen(true), size: "small", children: "Add languages" }) }));
    }
    const tooMany = chosen.length > left;
    return (_jsxs("div", { style: { borderTop: '1px solid var(--theme-elevation-100)', marginTop: 10, paddingTop: 10 }, children: [_jsx("input", { onChange: (e) => setFilter(e.target.value), placeholder: "Find a language", type: "search", value: filter }), _jsx("div", { className: "vs-speech-langs", children: options.map((l) => (_jsxs("label", { children: [_jsx("input", { checked: chosen.includes(l.code), onChange: (e) => setChosen((c) => (e.target.checked ? [...c, l.code] : c.filter((x) => x !== l.code))), type: "checkbox" }), l.name, canSpeak.has(l.code) ? ' 🔊' : ''] }, l.code))) }), _jsxs("p", { className: tooMany ? 'vs-speech-error' : 'vs-speech-muted', style: { marginBottom: 8 }, children: ["\uD83D\uDD0A is read aloud too. ", left, " more language", left === 1 ? '' : 's', " can be added (", LANGUAGE_LIMIT, " at most per recording). VocalStack carries on translating and reading after you leave this page."] }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6 }, children: [_jsx(Button, { disabled: busy || !chosen.length || tooMany, margin: false, onClick: () => go(true), size: "small", children: "Translate and read aloud" }), _jsx(Button, { buttonStyle: "secondary", disabled: busy || !chosen.length || tooMany, margin: false, onClick: () => go(false), size: "small", children: "Translate only" }), _jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => setOpen(false), size: "small", children: "Cancel" })] })] }));
};
