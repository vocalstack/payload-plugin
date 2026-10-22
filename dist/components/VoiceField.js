'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, toast, useConfig, useDocumentInfo, useForm } from '@payloadcms/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandStyles, Logo } from './Brand.js';
import { useAPI, useConnection } from './useConnection.js';
const POLL_MS = 3000;
const TARGET_S = 60;
const MIN_S = 30;
const MAX_S = 120;
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
`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** Whole sentences from `start`, about a minute of them: VocalStack clones from 30–120 s. */
function stretchFrom(sentences, start) {
    const from = sentences[start];
    const ids = new Set();
    let endS = from.end;
    for (let i = start; i < sentences.length; i++) {
        const s = sentences[i];
        if (s.end - from.start > MAX_S)
            break;
        ids.add(s.id);
        endS = s.end;
        if (endS - from.start >= TARGET_S)
            break;
    }
    return { endS, ids, startS: from.start };
}
/** Ogg/Opus where the browser plays it, else CAF (Safari). */
const previewFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'caf');
export const VoiceField = () => {
    const { id, collectionSlug } = useDocumentInfo();
    const { dispatchFields } = useForm();
    const { connection } = useConnection();
    const call = useAPI();
    const base = `/${collectionSlug}/${id}/vocalstack/voice`;
    const [voice, setVoice] = useState();
    const [name, setName] = useState('');
    const [error, setError] = useState();
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const timer = useRef(undefined);
    // Keep the form's copy in step with the server's, so saving the document keeps the voice.
    const apply = useCallback((res) => {
        setVoice(res.vocalstackVoice);
        if (res.name)
            setName(res.name);
        for (const [key, value] of Object.entries(res.vocalstackVoice)) {
            dispatchFields({ type: 'UPDATE', initialValue: value, path: `vocalstackVoice.${key}`, value });
        }
    }, [dispatchFields]);
    const refresh = useCallback(async () => {
        clearTimeout(timer.current);
        try {
            const res = await call(base);
            apply(res);
            setError(undefined);
            if (res.vocalstackVoice.state === 'training')
                timer.current = setTimeout(refresh, POLL_MS);
        }
        catch (err) {
            setError(err.message);
            // Unavailable for now: keep checking on a training voice, more slowly.
            if (voice?.state === 'training')
                timer.current = setTimeout(refresh, POLL_MS * 3);
        }
    }, [apply, base, call, voice?.state]);
    useEffect(() => {
        if (id && connection?.connected)
            void refresh();
        return () => clearTimeout(timer.current);
        // Once per document; `refresh` re-arms itself while training.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, connection?.connected]);
    const remove = async () => {
        if (!window.confirm(`Delete ${name || 'this'} voice? Readings already made with it stay as they are.`))
            return;
        setBusy(true);
        try {
            apply(await call(base, { method: 'DELETE' }));
            toast.success('Voice deleted.');
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 };
    const state = voice?.state ?? 'none';
    return (_jsxs("div", { className: "field-type vs-brand vs-voice", style: { marginBottom: 'var(--base)' }, children: [_jsx(BrandStyles, {}), _jsx("style", { children: styles }), _jsxs("div", { className: "field-label", style: { alignItems: 'center', display: 'flex', gap: 8, marginBottom: 'calc(var(--base) / 2)' }, children: [_jsx(Logo, { height: 14 }), " ", _jsx("span", { children: "Voice" })] }), !id ? (_jsx("p", { style: muted, children: "Save first, then create a voice." })) : connection && !connection.connected ? (_jsx("p", { style: muted, children: "Connect VocalStack (Settings \u2192 VocalStack) to create a voice." })) : !voice ? (_jsx("p", { style: muted, children: error ?? 'Checking…' })) : creating || state === 'none' || state === 'failed' ? (creating ? (_jsx(CreateVoice, { base: base, name: name, onCancel: () => setCreating(false), onCreated: (res) => {
                    apply(res);
                    setCreating(false);
                    timer.current = setTimeout(refresh, POLL_MS);
                } })) : (_jsxs("div", { style: { display: 'grid', gap: 8 }, children: [state === 'failed' ? (_jsxs("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: ["The voice could not be made: ", voice.error ?? 'VocalStack gave no reason', "."] })) : (_jsxs("p", { style: muted, children: ["Clone ", name || 'their', " voice to read translations aloud in it."] })), _jsx("div", { children: _jsx(Button, { margin: false, onClick: () => setCreating(true), size: "small", children: state === 'failed' ? 'Try again' : 'Create a voice' }) })] }))) : state === 'training' ? (_jsxs("div", { children: [_jsxs("p", { style: muted, children: ["Training the voice", voice.progress ? ` · ${voice.progress}%` : '…'] }), _jsx("div", { style: { background: 'var(--theme-elevation-100)', borderRadius: 2, height: 4, marginTop: 4, overflow: 'hidden' }, children: _jsx("div", { style: { background: 'var(--vs-accent)', height: '100%', transition: 'width .4s', width: `${Math.max(2, voice.progress ?? 0)}%` } }) })] })) : (_jsx(ReadyVoice, { base: base, busy: busy, onDelete: remove, voice: voice })), error && voice && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)', marginTop: 8 }, children: error })] }));
};
const ReadyVoice = ({ base, busy, onDelete, voice }) => {
    const call = useAPI();
    const [langs, setLangs] = useState();
    const [lang, setLang] = useState('en');
    const [src, setSrc] = useState();
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState();
    const audio = useRef(null);
    const { serverURL, api } = useAPIBase();
    useEffect(() => {
        call('/vocalstack/languages').then(setLangs, (err) => setError(err.message));
    }, [call]);
    /** The preview is made on first ask (202): ask until it is there, then play it. */
    const play = async () => {
        setError(undefined);
        setWaiting(true);
        const url = `${serverURL}${api}${base}/preview?${new URLSearchParams({ format: previewFormat(), lang })}`;
        try {
            for (let i = 0; i < 20; i++) {
                const res = await fetch(url, { credentials: 'include' });
                if (res.status === 202) {
                    await new Promise((r) => setTimeout(r, 2000));
                    continue;
                }
                if (!res.ok)
                    throw new Error((await res.json().catch(() => ({}))).error ?? `Preview failed (${res.status})`);
                setSrc(URL.createObjectURL(await res.blob()));
                requestAnimationFrame(() => void audio.current?.play().catch(() => undefined));
                return;
            }
            throw new Error('The preview is taking a while; try again in a minute.');
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setWaiting(false);
        }
    };
    const names = new Map(langs?.languages.map((l) => [l.code, l.name]));
    const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 };
    return (_jsxs("div", { style: { display: 'grid', gap: 8 }, children: [_jsxs("p", { style: muted, children: ["Ready", voice.sampleS ? `, cloned from ${Math.round(voice.sampleS)} s of speech` : '', ". Translations are read in this voice."] }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("select", { "aria-label": "Preview language", onChange: (e) => setLang(e.target.value), value: lang, children: (langs?.voice ?? ['en']).map((code) => (_jsx("option", { value: code, children: names.get(code) ?? code }, code))) }), _jsx(Button, { buttonStyle: "secondary", disabled: waiting, margin: false, onClick: play, size: "small", children: waiting ? 'Making…' : '▶ Hear' })] }), src && _jsx("audio", { controls: true, ref: audio, src: src, style: { width: '100%' } }), error && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: error }), _jsx("div", { children: _jsx(Button, { buttonStyle: "error", disabled: busy, margin: false, onClick: onDelete, size: "small", children: "Delete voice" }) })] }));
};
const CreateVoice = ({ base, name, onCancel, onCreated }) => {
    const call = useAPI();
    const { serverURL, api } = useAPIBase();
    const [tab, setTab] = useState('recording');
    const [sources, setSources] = useState();
    const [sourceIdx, setSourceIdx] = useState(0);
    const [start, setStart] = useState();
    const [file, setFile] = useState();
    const [fileS, setFileS] = useState();
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState();
    useEffect(() => {
        call(`${base}/sources`).then((r) => {
            setSources(r.sources);
            if (!r.sources.length)
                setTab('file');
        }, (err) => setError(err.message));
    }, [base, call]);
    const source = sources?.[sourceIdx];
    const sentences = useMemo(() => source?.sentences ?? [], [source]);
    const stretch = start !== undefined && sentences[start] ? stretchFrom(sentences, start) : undefined;
    const length = stretch ? stretch.endS - stretch.startS : tab === 'file' ? fileS : undefined;
    const longEnough = (length ?? 0) >= MIN_S - 1.5;
    const pick = (f) => {
        setFile(f);
        setFileS(undefined);
        if (!f)
            return;
        // Measure it: VocalStack needs at least 30 s.
        const a = new Audio(URL.createObjectURL(f));
        a.onloadedmetadata = () => setFileS(a.duration);
    };
    const create = async () => {
        setBusy(true);
        setError(undefined);
        try {
            let res;
            if (tab === 'recording' && source && stretch) {
                res = await call(base, { body: JSON.stringify({ consent, endS: stretch.endS, recordingId: source.recordingId, startS: stretch.startS }), method: 'POST' });
            }
            else if (file) {
                const form = new FormData();
                form.append('file', file);
                form.append('_payload', JSON.stringify({ consent }));
                const r = await fetch(`${serverURL}${api}${base}`, { body: form, credentials: 'include', method: 'POST' });
                const body = await r.json().catch(() => ({}));
                if (!r.ok)
                    throw new Error(body.error ?? (r.status === 413 ? 'The sample is too large; use a shorter or compressed file.' : `Request failed (${r.status})`));
                res = body;
            }
            else
                return;
            toast.success('Voice created. It is training now.');
            onCreated(res);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 };
    const clipURL = stretch && source ? `${serverURL}${api}/vocalstack/clip?${new URLSearchParams({ endS: String(stretch.endS), recording: source.recordingId, startS: String(stretch.startS) })}` : undefined;
    return (_jsxs("div", { style: { display: 'grid', gap: 10 }, children: [_jsxs("div", { className: "vs-voice-tabs", children: [_jsx(Button, { buttonStyle: tab === 'recording' ? 'primary' : 'secondary', margin: false, onClick: () => setTab('recording'), size: "small", children: "From a recording" }), _jsx(Button, { buttonStyle: tab === 'file' ? 'primary' : 'secondary', margin: false, onClick: () => setTab('file'), size: "small", children: "Upload a sample" })] }), tab === 'recording' ? (!sources ? (_jsx("p", { style: muted, children: error ? '' : 'Looking for transcribed recordings…' })) : !sources.length ? (_jsxs("p", { style: muted, children: ["No transcribed recordings of ", name || 'them', " yet. Transcribe one, or upload a sample."] })) : (_jsxs(_Fragment, { children: [sources.length > 1 && (_jsx("select", { "aria-label": "Recording", onChange: (e) => {
                            setSourceIdx(Number(e.target.value));
                            setStart(undefined);
                        }, value: sourceIdx, children: sources.map((s, i) => (_jsx("option", { value: i, children: s.label }, s.recordingId))) })), _jsxs("p", { style: muted, children: ["Click where ", name || 'they', " start speaking alone, with no music or other voices. About a minute is taken from there."] }), _jsx("div", { className: "vs-voice-list", children: sentences.map((s, i) => (_jsxs("button", { className: `vs-voice-line${stretch?.ids.has(s.id) ? ' vs-voice-line--in' : ''}${i === start ? ' vs-voice-line--start' : ''}`, onClick: () => setStart(i), type: "button", children: [_jsx("span", { className: "vs-voice-time", children: clock(s.start) }), _jsx("span", { children: s.text })] }, s.id ?? i))) }), stretch && (_jsxs(_Fragment, { children: [_jsxs("p", { style: muted, children: [clock(stretch.startS), "\u2013", clock(stretch.endS), " \u00B7 ", Math.round(stretch.endS - stretch.startS), " s", longEnough ? '' : ` (at least ${MIN_S} s needed)`] }), _jsx("audio", { controls: true, preload: "none", src: clipURL, style: { width: '100%' } }, clipURL)] }))] }))) : (_jsxs(_Fragment, { children: [_jsxs("p", { style: muted, children: [MIN_S, " s to 2 min of ", name || 'them', " speaking alone, clearly, with no music. An MP3 or M4A of about a minute is ideal."] }), _jsx("input", { accept: "audio/*", onChange: (e) => pick(e.target.files?.[0]), type: "file" }), file && fileS !== undefined && !longEnough && _jsxs("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: ["That is ", Math.round(fileS), " s; at least ", MIN_S, " s is needed."] })] })), _jsxs("label", { style: { alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }, children: [_jsx("input", { checked: consent, onChange: (e) => setConsent(e.target.checked), style: { marginTop: 3 }, type: "checkbox" }), _jsxs("span", { children: ["I have ", name || 'their', "\u2019s permission to clone their voice."] })] }), error && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: error }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx(Button, { disabled: busy || !consent || !longEnough || (tab === 'file' ? !file : !stretch), margin: false, onClick: create, size: "small", children: busy ? 'Creating…' : 'Create voice' }), _jsx(Button, { buttonStyle: "secondary", disabled: busy, margin: false, onClick: onCancel, size: "small", children: "Cancel" })] })] }));
};
function useAPIBase() {
    const { config: { routes: { api }, serverURL, }, } = useConfig();
    return { api, serverURL };
}
