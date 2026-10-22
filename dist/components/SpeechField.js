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
  .vs-speech-error { color: var(--theme-error-500); font-size: 13px; margin: 0; }
  .vs-speech select, .vs-speech input[type=search] { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--theme-elevation-150);
    border-radius: var(--style-radius-s, 4px); background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); max-width: 100%; }
  .vs-speech audio { height: 32px; width: 100%; }
  .vs-speech-langs { columns: 3 160px; max-height: 200px; overflow-y: auto; margin: 8px 0; font-size: 13px; }
  .vs-speech-langs label { display: flex; gap: 6px; align-items: center; break-inside: avoid; padding: 2px 0; }
  .vs-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--theme-elevation-200); border-top-color: var(--vs-accent);
    border-radius: 50%; animation: vs-spin .8s linear infinite; margin-right: 6px; vertical-align: -1px; }
  @keyframes vs-spin { to { transform: rotate(360deg); } }
`;
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
    const recordingId = useFormFields(([fields]) => fields[`${group}recordingId`]?.value);
    const [langs, setLangs] = useState();
    const [defaultVoice, setDefaultVoice] = useState(null);
    const [voices, setVoices] = useState({});
    const [picked, setPicked] = useState({});
    const [working, setWorking] = useState({});
    const [error, setError] = useState();
    const timer = useRef(undefined);
    const base = `/${collectionSlug}/${id}/vocalstack`;
    // The server saved these; make them the form's saved state too, so Save keeps them.
    const apply = useCallback((data) => {
        for (const key of ['translations', 'speech']) {
            if (data && key in data)
                dispatchFields({ type: 'UPDATE', initialValue: data[key], path: `${group}${key}`, value: data[key] });
        }
    }, [dispatchFields, group]);
    const busySpeech = Object.values(speech).some((s) => s.state === 'queued' || s.state === 'running');
    const check = useCallback(async () => {
        clearTimeout(timer.current);
        try {
            const res = await call(`${base}/speak${query}`);
            setDefaultVoice(res.defaultVoice ?? null);
            apply(res.vocalstack);
            const before = speech;
            for (const [lang, s] of Object.entries(res.vocalstack.speech ?? {})) {
                if (s.state === 'sealed' && before[lang]?.state !== 'sealed')
                    toast.success(`The ${lang.toUpperCase()} reading is ready.`);
            }
            setError(undefined);
        }
        catch (err) {
            setError(err.message);
        }
    }, [apply, base, call, query, speech]);
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
    const loadVoices = useCallback((lang) => {
        if (voices[lang])
            return;
        setVoices((v) => ({ ...v, [lang]: [] }));
        call(`/vocalstack/voices?${new URLSearchParams({ lang, ...(recordingId ? { recording: recordingId } : {}) })}`).then((r) => setVoices((v) => ({ ...v, [lang]: r.voices })), () => undefined);
    }, [call, recordingId, voices]);
    const names = useMemo(() => new Map(langs?.languages.map((l) => [l.code, l.name])), [langs]);
    const canSpeak = useMemo(() => new Set(langs?.voice), [langs]);
    const shown = [...new Set([...Object.keys(translations), ...Object.keys(speech)])].sort((a, b) => (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
    const speakable = shown.filter((l) => canSpeak.has(l)).join();
    useEffect(() => {
        for (const l of speakable.split(','))
            if (l)
                loadVoices(l);
    }, [loadVoices, speakable]);
    /** Translate until done (each call stops after a while and says whether there is more). */
    const translate = async (list) => {
        if (!list.length)
            return;
        for (;;) {
            const res = await call(`${base}/translate${query}`, { body: JSON.stringify({ langs: list }), method: 'POST' });
            apply(res.vocalstack);
            if (!res.more)
                return;
        }
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
    const speak = (list, voice) => run(list, 'Translating…', async () => {
        await translate(list.filter((l) => !translations[l]));
        const res = await call(`${base}/speak${query}`, { body: JSON.stringify({ langs: list, voice: voice || undefined }), method: 'POST' });
        apply(res.vocalstack);
        setDefaultVoice(res.defaultVoice ?? null);
    });
    const remove = (lang) => window.confirm(`Remove the ${names.get(lang) ?? lang} translation${speech[lang] ? ' and its reading' : ''}?`) &&
        run([lang], 'Removing…', async () => {
            apply((await call(`${base}/translate${withQuery({ lang })}`, { method: 'DELETE' })).vocalstack);
        });
    const voiceName = (lang, key) => {
        if (!key)
            return 'VocalStack’s default voice';
        return voices[lang]?.find((v) => v.id === key)?.name ?? (key.startsWith('clone:') ? 'a cloned voice' : key);
    };
    if (!id)
        return null;
    return (_jsxs("div", { className: "vs-brand vs-speech", children: [_jsx(BrandStyles, {}), _jsx("style", { children: styles }), _jsx("h4", { children: "Translations and readings" }), !shown.length && _jsx("p", { className: "vs-speech-muted", children: "Translate the transcript so listeners can read along, or hear it read aloud, in their language." }), shown.map((lang) => {
                const t = translations[lang];
                const s = speech[lang];
                const busy = working[lang];
                const voicesHere = voices[lang] ?? [];
                return (_jsxs("div", { className: "vs-speech-row", children: [_jsxs("div", { children: [_jsx("strong", { children: names.get(lang) ?? lang }), _jsx("p", { className: "vs-speech-muted", children: t ? `${t.sentences.length} sentences translated` : 'Not translated' })] }), _jsxs("div", { style: { display: 'grid', gap: 6 }, children: [busy ? (_jsxs("span", { className: "vs-speech-muted", children: [_jsx("span", { className: "vs-spin" }), busy] })) : s?.state === 'queued' || s?.state === 'running' ? (_jsxs("span", { className: "vs-speech-muted", children: [_jsx("span", { className: "vs-spin" }), s.state === 'queued' ? 'Waiting to be read aloud…' : 'Being read aloud…', " (", voiceName(lang, s.voice), ")"] })) : s?.state === 'sealed' ? (_jsxs(_Fragment, { children: [_jsx("audio", { controls: true, preload: "none", src: `${serverURL}${api}${base}/audio${withQuery({ lang, v: s.renderedAt ?? '' })}` }, s.renderedAt ?? ''), _jsxs("span", { className: "vs-speech-muted", children: ["Read by ", voiceName(lang, s.voice)] })] })) : s?.state === 'failed' ? (_jsxs("p", { className: "vs-speech-error", children: ["Reading failed: ", s.error ?? 'no reason given'] })) : !canSpeak.has(lang) ? (_jsxs("span", { className: "vs-speech-muted", children: ["VocalStack cannot read ", names.get(lang) ?? lang, " aloud yet."] })) : null, canSpeak.has(lang) && !busy && s?.state !== 'queued' && s?.state !== 'running' && (_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6 }, children: [_jsxs("select", { "aria-label": "Voice", onChange: (e) => setPicked((p) => ({ ...p, [lang]: e.target.value })), value: picked[lang] ?? '', children: [_jsxs("option", { value: "", children: ["Default for this recording (", voiceName(lang, defaultVoice), ")"] }), voicesHere.map((v) => (_jsxs("option", { disabled: v.ready === false && v.cloned, value: v.id, children: [v.name, v.cloned ? ' (cloned)' : ''] }, v.id)))] }), _jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => speak([lang], picked[lang]), size: "small", children: s ? 'Read again' : 'Read aloud' })] }))] }), _jsx(Button, { buttonStyle: "secondary", disabled: Boolean(busy), margin: false, onClick: () => remove(lang), size: "small", children: "Remove" })] }, lang));
            }), _jsx(AddLanguages, { busy: Object.keys(working).length > 0, canSpeak: canSpeak, exclude: new Set([...shown, ...(spoken ? [spoken] : [])]), langs: langs, onSpeak: (list) => speak(list), onTranslate: (list) => run(list, 'Translating…', () => translate(list)) }), error && _jsx("p", { className: "vs-speech-error", children: error })] }));
};
const AddLanguages = ({ busy, canSpeak, exclude, langs, onSpeak, onTranslate }) => {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [chosen, setChosen] = useState([]);
    if (!langs)
        return null;
    const options = langs.languages
        .filter((l) => l.translation && !exclude.has(l.code))
        .filter((l) => !filter || `${l.name} ${l.native} ${l.code}`.toLowerCase().includes(filter.toLowerCase()));
    const go = async (fn) => {
        const list = chosen;
        setChosen([]);
        setOpen(false);
        await fn(list);
    };
    if (!open) {
        return (_jsx("div", { style: { marginTop: 10 }, children: _jsx(Button, { buttonStyle: "secondary", disabled: busy, margin: false, onClick: () => setOpen(true), size: "small", children: "Add languages" }) }));
    }
    // A reading is at most a few languages at a time.
    const speakable = chosen.filter((l) => canSpeak.has(l));
    return (_jsxs("div", { style: { borderTop: '1px solid var(--theme-elevation-100)', marginTop: 10, paddingTop: 10 }, children: [_jsx("input", { onChange: (e) => setFilter(e.target.value), placeholder: "Find a language", type: "search", value: filter }), _jsx("div", { className: "vs-speech-langs", children: options.map((l) => (_jsxs("label", { children: [_jsx("input", { checked: chosen.includes(l.code), onChange: (e) => setChosen((c) => (e.target.checked ? [...c, l.code] : c.filter((x) => x !== l.code))), type: "checkbox" }), l.name, canSpeak.has(l.code) ? ' 🔊' : ''] }, l.code))) }), _jsx("p", { className: "vs-speech-muted", style: { marginBottom: 8 }, children: "\uD83D\uDD0A can also be read aloud. Translating a long recording takes a few minutes." }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6 }, children: [_jsx(Button, { disabled: busy || !chosen.length, margin: false, onClick: () => go(onTranslate), size: "small", children: "Translate" }), _jsx(Button, { disabled: busy || !speakable.length || speakable.length > 3, margin: false, onClick: () => go(async (list) => {
                            await onTranslate(list.filter((l) => !canSpeak.has(l)));
                            await onSpeak(list.filter((l) => canSpeak.has(l)));
                        }), size: "small", children: speakable.length > 3 ? 'Read aloud: 3 at a time' : 'Translate and read aloud' }), _jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => setOpen(false), size: "small", children: "Cancel" })] })] }));
};
