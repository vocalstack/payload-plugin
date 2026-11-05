'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, toast, useConfig, useDocumentInfo, useForm } from '@payloadcms/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandStyles, Logo } from './Brand.js';
import { useAPI, useConnection } from './useConnection.js';
import { RecordSample, VoiceFromRecording } from './VoiceSamples.js';
const POLL_MS = 3000;
const MIN_S = 30;
const styles = `
  .vs-voice-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
  .vs-voice select, .vs-voice input[type=file] { width: 100%; font: inherit; }
  .vs-voice select { padding: 6px 8px; border: 1px solid var(--theme-elevation-150); border-radius: var(--style-radius-s, 4px);
    background: var(--theme-input-bg, var(--theme-elevation-0)); color: var(--theme-text); }
`;
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
    const [file, setFile] = useState();
    const [fileS, setFileS] = useState();
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState();
    useEffect(() => {
        call(`${base}/sources`).then((r) => {
            setSources(r.sources);
            if (!r.sources.length)
                setTab('record');
        }, (err) => setError(err.message));
    }, [base, call]);
    const longEnough = (fileS ?? 0) >= MIN_S - 1.5;
    const pick = (f) => {
        setFile(f);
        setFileS(undefined);
        if (!f)
            return;
        // Measure it: VocalStack needs at least 30 s.
        const a = new Audio(URL.createObjectURL(f));
        a.onloadedmetadata = () => setFileS(a.duration);
    };
    const switchTo = (next) => {
        setTab(next);
        setFile(undefined);
        setFileS(undefined);
        setError(undefined);
    };
    /** A recorded or uploaded sample: sent through the server to VocalStack. */
    const upload = async () => {
        if (!file)
            return;
        setBusy(true);
        setError(undefined);
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('_payload', JSON.stringify({ consent }));
            const r = await fetch(`${serverURL}${api}${base}`, { body: form, credentials: 'include', method: 'POST' });
            const body = await r.json().catch(() => ({}));
            if (!r.ok)
                throw new Error(body.error ?? (r.status === 413 ? 'The sample is too large; use a shorter or compressed file.' : `Request failed (${r.status})`));
            toast.success('Voice created. It is training now.');
            onCreated(body);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 };
    const tabs = [
        ['recording', 'From a sermon'],
        ['record', 'Record'],
        ['file', 'Upload'],
    ];
    return (_jsxs("div", { style: { display: 'grid', gap: 10 }, children: [_jsx("div", { className: "vs-voice-tabs", children: tabs.map(([key, label]) => (_jsx(Button, { buttonStyle: tab === key ? 'primary' : 'secondary', margin: false, onClick: () => switchTo(key), size: "small", children: label }, key))) }), tab === 'recording' ? (!sources ? (_jsx("p", { style: muted, children: error ? '' : 'Looking for transcribed recordings…' })) : !sources.length ? (_jsxs("p", { style: muted, children: ["No transcribed recordings of ", name || 'them', " yet. Transcribe one, or record a sample."] })) : (_jsx(VoiceFromRecording, { base: base, name: name, onCreated: onCreated, sources: sources }))) : (_jsxs(_Fragment, { children: [tab === 'record' ? (_jsx(RecordSample, { onRecorded: (f, seconds) => {
                            setFile(f);
                            setFileS(seconds);
                        } })) : (_jsxs(_Fragment, { children: [_jsxs("p", { style: muted, children: [MIN_S, " s to 2 min of ", name || 'them', " speaking alone, clearly, with no music. An MP3 or M4A of about a minute is ideal."] }), _jsx("input", { accept: "audio/*", onChange: (e) => pick(e.target.files?.[0]), type: "file" })] })), file && fileS !== undefined && !longEnough && _jsxs("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: ["That is ", Math.round(fileS), " s; at least ", MIN_S, " s is needed."] }), _jsxs("label", { style: { alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }, children: [_jsx("input", { checked: consent, onChange: (e) => setConsent(e.target.checked), style: { marginTop: 3 }, type: "checkbox" }), _jsxs("span", { children: ["I have ", name || 'their', "\u2019s permission to clone their voice."] })] }), error && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: error }), _jsx("div", { children: _jsx(Button, { disabled: busy || !consent || !longEnough || !file, margin: false, onClick: upload, size: "small", children: busy ? 'Creating…' : 'Create voice' }) })] })), _jsx("div", { children: _jsx(Button, { buttonStyle: "secondary", disabled: busy, margin: false, onClick: onCancel, size: "small", children: "Cancel" }) })] }));
};
function useAPIBase() {
    const { config: { routes: { api }, serverURL, }, } = useConfig();
    return { api, serverURL };
}
