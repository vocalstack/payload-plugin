'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, toast, useConfig } from '@payloadcms/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAPI } from './useConnection.js';
/** As in the VocalStack dashboard: at least 5 s makes a voice, 20 s a steadier one, 25 s is plenty; 60 s at most. */
export const PICK_MIN_S = 5;
const PICK_GOOD_S = 20;
const PICK_TARGET_S = 25;
const PICK_MAX_S = 60;
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
`;
const secs = (c) => Math.max(0, c.end - c.start);
const TERMINAL = /[.!?…。！？।؟;]["'”’»)\]]*$/;
/** The sentences of the one who speaks most in the recording: the person whose voice this is. */
function candidates(sentences) {
    const bySpeaker = new Map();
    for (const s of sentences)
        if (s.speaker >= 0)
            bySpeaker.set(s.speaker, (bySpeaker.get(s.speaker) ?? 0) + (s.end - s.start));
    const speaker = [...bySpeaker.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const clips = sentences.filter((s) => s.speaker === speaker && s.end > s.start && s.text.trim()).map((s) => ({ end: s.end, start: s.start, text: s.text.trim() }));
    return { clips, speaker };
}
/** The clearest picks first, as the dashboard ranks them: whole sentences of 4–11 s, about 8 s best. */
function chooseFor(clips) {
    const tier = (c) => (!TERMINAL.test(c.text) ? 2 : secs(c) >= 4 && secs(c) <= 11 ? 0 : 1);
    const near = (c) => -Math.abs(secs(c) - 8);
    const order = clips.map((c, i) => i).sort((a, b) => tier(clips[a]) - tier(clips[b]) || near(clips[b]) - near(clips[a]) || a - b);
    const out = new Set();
    let total = 0;
    for (const i of order) {
        if (total + 0.05 >= PICK_TARGET_S)
            break;
        if (total + secs(clips[i]) > PICK_MAX_S + 0.5)
            continue;
        out.add(i);
        total += secs(clips[i]);
    }
    return out;
}
const pickedSeconds = (clips, picked) => [...picked].reduce((t, i) => t + (clips[i] ? secs(clips[i]) : 0), 0);
const spansOf = (clips, picked) => [...picked]
    .filter((i) => clips[i])
    .sort((a, b) => clips[a].start - clips[b].start)
    .map((i) => ({ end: clips[i].end, start: clips[i].start }));
function useBase() {
    const { config: { routes: { api }, serverURL, }, } = useConfig();
    return `${serverURL}${api}`;
}
/** One sentence of the recording: its waveform, and a play button. */
const SampleAudio = ({ src }) => {
    const [bars, setBars] = useState();
    const [url, setUrl] = useState();
    const [at, setAt] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    const audio = useRef(null);
    useEffect(() => {
        let gone = false;
        let made;
        setBars(undefined);
        setUrl(undefined);
        setFailed(false);
        setAt(0);
        setPlaying(false);
        fetch(src, { credentials: 'include' })
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r)))
            .then((wav) => {
            if (gone)
                return;
            // 16-bit PCM after the 44-byte header: the peak of each stretch, as a bar.
            const pcm = new Int16Array(wav, 44, Math.max(0, (wav.byteLength - 44) >> 1));
            const n = 40;
            const per = Math.max(1, Math.floor(pcm.length / n));
            const peaks = Array.from({ length: n }, (_, i) => {
                let p = 0;
                for (let k = i * per; k < Math.min((i + 1) * per, pcm.length); k++)
                    p = Math.max(p, Math.abs(pcm[k]));
                return p;
            });
            const top = Math.max(1, ...peaks);
            setBars(peaks.map((p) => 14 + (p / top) * 86));
            made = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
            setUrl(made);
        })
            .catch(() => !gone && setFailed(true));
        return () => {
            gone = true;
            if (made)
                URL.revokeObjectURL(made);
        };
    }, [src]);
    const toggle = () => {
        const a = audio.current;
        if (!a)
            return;
        if (a.paused)
            void a.play();
        else
            a.pause();
    };
    const duration = audio.current?.duration || 0;
    const share = duration ? at / duration : 0;
    return (_jsxs("div", { className: "vs-sample-play", children: [_jsx("button", { "aria-label": playing ? 'Pause' : 'Play', className: "vs-play", disabled: !url, onClick: toggle, type: "button", children: playing ? '❚❚' : '▶' }), _jsx("div", { className: "vs-wave", children: failed ? (_jsx("span", { style: { background: 'none', color: 'var(--theme-elevation-500)', fontSize: 12 }, children: "Could not load this sample." })) : ((bars ?? Array.from({ length: 40 }, () => 14)).map((h, i, all) => _jsx("span", { className: i / all.length < share ? 'on' : '', style: { height: `${h}%` } }, i))) }), _jsx("span", { style: { fontVariantNumeric: 'tabular-nums', fontSize: 13 }, children: `00:${String(Math.round(duration - at || 0)).padStart(2, '0')}` }), url && (_jsx("audio", { onEnded: () => {
                    setPlaying(false);
                    setAt(0);
                }, onPause: () => setPlaying(false), onPlay: () => setPlaying(true), onTimeUpdate: (e) => setAt(e.currentTarget.currentTime), ref: audio, src: url }))] }));
};
/**
 * Clone a voice from sentences of one of the person's own transcribed recordings, as in the
 * VocalStack dashboard: pick samples (or have them chosen), hear the voice, then name and keep it.
 */
export const VoiceFromRecording = ({ base, name, onCreated, sources }) => {
    const call = useAPI();
    const apiBase = useBase();
    const [sourceIdx, setSourceIdx] = useState(0);
    const source = sources[sourceIdx];
    const { clips, speaker } = useMemo(() => candidates(source?.sentences ?? []), [source]);
    const [idx, setIdx] = useState(0);
    const [picked, setPicked] = useState(new Set());
    const [step, setStep] = useState(1);
    const [trial, setTrial] = useState();
    const [voiceName, setVoiceName] = useState(name);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState();
    const kept = useRef(false);
    const trialId = useRef(undefined);
    trialId.current = trial?.id;
    // A trial voice nobody kept is deleted when the panel closes.
    useEffect(() => () => {
        if (trialId.current && !kept.current)
            void call(`${base}/trial?${new URLSearchParams({ voice: trialId.current })}`, { method: 'DELETE' }).catch(() => undefined);
    }, [base, call]);
    // Follow the trial voice while it trains.
    useEffect(() => {
        if (!trial || (trial.state !== 'training' && trial.state !== 'queued'))
            return;
        const t = setTimeout(() => {
            call(`${base}/trial?${new URLSearchParams({ voice: trial.id })}`).then((r) => setTrial((cur) => (cur?.id === r.voice.id ? { ...cur, ...r.voice } : cur)), () => undefined);
        }, 2000);
        return () => clearTimeout(t);
    }, [base, call, trial]);
    const total = pickedSeconds(clips, picked);
    const pickKey = JSON.stringify(spansOf(clips, picked));
    const clip = clips[Math.min(idx, clips.length - 1)];
    const here = picked.has(idx);
    const room = here || (clip && total + secs(clip) <= PICK_MAX_S + 0.5);
    const enough = total + 0.05 >= PICK_MIN_S && total <= PICK_MAX_S + 0.5;
    const best = useMemo(() => chooseFor(clips), [clips]);
    const chosen = best.size > 0 && best.size === picked.size && [...best].every((i) => picked.has(i));
    const toggle = (i) => setPicked((p) => {
        const next = new Set(p);
        if (next.has(i))
            next.delete(i);
        else if (clips[i] && pickedSeconds(clips, p) + secs(clips[i]) <= PICK_MAX_S + 0.5)
            next.add(i);
        return next;
    });
    /** Step 2: make a trial voice from the picked samples (a new one when the picks changed). */
    const tryVoice = async () => {
        setStep(2);
        if (trial && trial.key === pickKey && trial.state !== 'failed')
            return;
        setBusy(true);
        setError(undefined);
        try {
            const r = await call(`${base}/trial`, {
                body: JSON.stringify({ recordingId: source.recordingId, replace: trial?.id, spans: spansOf(clips, picked), speaker }),
                method: 'POST',
            });
            setTrial({ ...r.voice, key: pickKey });
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setBusy(false);
        }
    };
    const keep = async () => {
        if (!trial)
            return;
        setBusy(true);
        setError(undefined);
        try {
            const res = await call(`${base}/trial/keep`, {
                body: JSON.stringify({ consent, name: voiceName, voice: trial.id }),
                method: 'POST',
            });
            kept.current = true;
            toast.success('Speaker saved.');
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
    const scale = PICK_TARGET_S * 1.2;
    const meterAt = (s) => `${Math.min(100, (s / scale) * 100)}%`;
    const steps = ['Pick samples', 'Hear the voice', 'Name and save'];
    return (_jsxs("div", { style: { display: 'grid', gap: 10 }, children: [_jsx("style", { children: sampleStyles }), _jsx("div", { className: "vs-steps", children: steps.map((label, i) => (_jsxs("div", { className: `vs-step${step === i + 1 ? ' vs-step--on' : step > i + 1 ? ' vs-step--done' : ''}`, children: [i + 1, ". ", label] }, label))) }), step === 1 && (_jsxs(_Fragment, { children: [sources.length > 1 && (_jsx("select", { "aria-label": "Recording", onChange: (e) => {
                            setSourceIdx(Number(e.target.value));
                            setIdx(0);
                            setPicked(new Set());
                        }, value: sourceIdx, children: sources.map((s, i) => (_jsx("option", { value: i, children: s.label }, s.recordingId))) })), _jsxs("div", { style: { alignItems: 'baseline', display: 'flex', gap: 8, justifyContent: 'space-between' }, children: [_jsxs("p", { style: muted, children: ["Pick about ", PICK_TARGET_S, "s of clear speech, with no music or other voices."] }), _jsxs("strong", { style: { fontSize: 13, whiteSpace: 'nowrap' }, children: [Math.round(total), "s ", _jsxs("span", { style: { color: 'var(--theme-elevation-500)', fontWeight: 400 }, children: ["/ ", PICK_TARGET_S, "s"] })] })] }), _jsx("div", { children: _jsx(Button, { buttonStyle: "secondary", disabled: chosen || !clips.length, margin: false, onClick: () => setPicked(new Set(best)), size: "small", children: "\u2728 Choose for me" }) }), clip ? (_jsxs("div", { className: "vs-sample", children: [_jsxs("div", { className: "vs-sample-body", children: [_jsxs("div", { className: "vs-sample-head", children: [_jsxs("span", { children: ["Sample ", idx + 1, " of ", clips.length] }), _jsxs("span", { className: "vs-pager", children: [_jsx("button", { "aria-label": "Previous sample", disabled: idx === 0, onClick: () => setIdx((i) => Math.max(0, i - 1)), type: "button", children: "\u2039" }), _jsx("button", { "aria-label": "Next sample", disabled: idx >= clips.length - 1, onClick: () => setIdx((i) => Math.min(clips.length - 1, i + 1)), type: "button", children: "\u203A" })] })] }), _jsx("div", { className: "vs-sample-text", children: clip.text }), _jsx(SampleAudio, { src: `${apiBase}${base}/clip?${new URLSearchParams({ endS: clip.end.toFixed(2), recording: source.recordingId, startS: clip.start.toFixed(2) })}` })] }), _jsxs("label", { className: "vs-sample-use", style: { opacity: room ? 1 : 0.5 }, children: [_jsx("input", { checked: here, disabled: !room, onChange: () => toggle(idx), type: "checkbox" }), room ? 'Use this sample' : `Full: ${PICK_MAX_S}s at most`] })] })) : (_jsx("p", { style: muted, children: "No sentences of theirs in this recording." })), _jsxs("div", { children: [_jsx("div", { className: "vs-meter", children: _jsx("span", { style: { width: meterAt(total) } }) }), _jsx("div", { className: "vs-meter-marks", children: [PICK_MIN_S, PICK_GOOD_S, PICK_TARGET_S].map((s) => (_jsxs("span", { style: { fontWeight: total + 0.05 >= s ? 600 : 400, left: meterAt(s) }, children: [s, "s"] }, s))) })] }), _jsx("p", { style: muted, children: !picked.size
                            ? `At least ${PICK_MIN_S}s makes a voice.`
                            : total + 0.05 < PICK_MIN_S
                                ? `${Math.ceil(PICK_MIN_S - total)}s more to make a voice.`
                                : total >= PICK_TARGET_S
                                    ? 'Plenty.'
                                    : total + 0.05 < PICK_GOOD_S
                                        ? `Enough for a voice. ${PICK_GOOD_S}s or more sounds steadier.`
                                        : `Good. About ${PICK_TARGET_S}s gives it more to choose from.` }), picked.size ? (_jsx("div", { className: "vs-chips", children: [...picked]
                            .sort((a, b) => a - b)
                            .map((i) => (_jsxs("span", { className: "vs-chip", children: [_jsxs("button", { onClick: () => setIdx(i), style: { color: 'inherit', padding: 0 }, type: "button", children: [i + 1, " \u00B7 ", Math.round(secs(clips[i])), "s"] }), _jsx("button", { "aria-label": `Leave sample ${i + 1} out`, onClick: () => toggle(i), type: "button", children: "\u2715" })] }, i))) })) : (_jsx("span", { className: "vs-chips--none", children: "No samples picked yet" })), _jsx("div", { children: _jsx(Button, { disabled: !enough || busy, margin: false, onClick: tryVoice, size: "small", children: "Next" }) })] })), step === 2 && (_jsxs(_Fragment, { children: [!trial || trial.state === 'training' || trial.state === 'queued' ? (_jsxs("p", { style: muted, children: ["Making the voice", trial?.progress ? ` · ${trial.progress}%` : '…', " It takes a minute or two."] })) : trial.state === 'failed' ? (_jsxs("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: ["The voice could not be made: ", trial.error ?? 'no reason given', ". Pick other samples."] })) : (_jsx(TrialPreview, { base: base, voice: trial.id })), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => setStep(1), size: "small", children: "Back" }), _jsx(Button, { disabled: trial?.state !== 'ready', margin: false, onClick: () => setStep(3), size: "small", children: "Next" })] })] })), step === 3 && (_jsxs(_Fragment, { children: [_jsxs("label", { style: { display: 'grid', fontSize: 13, gap: 4 }, children: ["Name", _jsx("input", { maxLength: 60, onChange: (e) => setVoiceName(e.target.value), style: { font: 'inherit', padding: '6px 8px' }, value: voiceName })] }), _jsxs("label", { style: { alignItems: 'flex-start', display: 'flex', fontSize: 13, gap: 8 }, children: [_jsx("input", { checked: consent, onChange: (e) => setConsent(e.target.checked), style: { marginTop: 3 }, type: "checkbox" }), _jsxs("span", { children: ["I have ", name || 'their', "\u2019s permission to clone their voice."] })] }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx(Button, { buttonStyle: "secondary", disabled: busy, margin: false, onClick: () => setStep(2), size: "small", children: "Back" }), _jsx(Button, { disabled: busy || !consent || !voiceName.trim(), margin: false, onClick: keep, size: "small", children: busy ? 'Saving…' : 'Save speaker' })] })] })), error && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: error })] }));
};
/** Ogg/Opus where the browser plays it, else CAF (Safari). */
const previewFormat = () => (typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs=opus') ? 'ogg' : 'caf');
/** The trial voice speaking a few seconds, in a language picked. */
const TrialPreview = ({ base, voice }) => {
    const call = useAPI();
    const apiBase = useBase();
    const [langs, setLangs] = useState();
    const [lang, setLang] = useState('en');
    const [src, setSrc] = useState();
    const [waiting, setWaiting] = useState(false);
    const [error, setError] = useState();
    const audio = useRef(null);
    useEffect(() => {
        call('/vocalstack/languages').then(setLangs, () => undefined);
    }, [call]);
    const play = async () => {
        setError(undefined);
        setWaiting(true);
        const url = `${apiBase}${base}/trial/preview?${new URLSearchParams({ format: previewFormat(), lang, voice })}`;
        try {
            for (let i = 0; i < 30; i++) {
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
    return (_jsxs("div", { style: { display: 'grid', gap: 8 }, children: [_jsx("p", { style: { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 }, children: "Hear it before you keep it. Not right? Go back and pick other samples." }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("select", { "aria-label": "Preview language", onChange: (e) => setLang(e.target.value), value: lang, children: (langs?.voice ?? ['en']).map((code) => (_jsx("option", { value: code, children: names.get(code) ?? code }, code))) }), _jsx(Button, { buttonStyle: "secondary", disabled: waiting, margin: false, onClick: play, size: "small", children: waiting ? 'Making…' : '▶ Hear the voice' })] }), src && _jsx("audio", { controls: true, ref: audio, src: src, style: { width: '100%' } }), error && _jsx("p", { style: { color: 'var(--theme-error-500)', fontSize: 13, margin: 0 }, children: error })] }));
};
/** Record them speaking, in the browser, as the sample to clone from. */
export const RecordSample = ({ onRecorded }) => {
    const [recording, setRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [url, setUrl] = useState();
    const [error, setError] = useState();
    const rec = useRef(undefined);
    const started = useRef(0);
    useEffect(() => {
        if (!recording)
            return;
        const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
        return () => clearInterval(t);
    }, [recording]);
    const start = async () => {
        setError(undefined);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
            const chunks = [];
            const r = new MediaRecorder(stream);
            r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            r.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const type = r.mimeType || 'audio/webm';
                const blob = new Blob(chunks, { type });
                const seconds = (Date.now() - started.current) / 1000;
                setUrl(URL.createObjectURL(blob));
                onRecorded(new File([blob], `recording.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`, { type }), seconds);
            };
            rec.current = r;
            started.current = Date.now();
            setElapsed(0);
            setUrl(undefined);
            onRecorded(undefined, undefined);
            r.start(1000);
            setRecording(true);
        }
        catch {
            setError('The microphone could not be used. Allow it for this site, or upload a sample instead.');
        }
    };
    const stop = () => {
        rec.current?.stop();
        setRecording(false);
    };
    const muted = { color: 'var(--theme-elevation-500)', fontSize: 13, margin: 0 };
    return (_jsxs("div", { style: { display: 'grid', gap: 8 }, children: [_jsx("p", { style: muted, children: "Record them reading or speaking naturally for 30 seconds to a minute, alone, in a quiet room." }), _jsxs("div", { style: { alignItems: 'center', display: 'flex', gap: 10 }, children: [_jsx(Button, { buttonStyle: recording ? 'error' : 'primary', margin: false, onClick: recording ? stop : start, size: "small", children: recording ? '■ Stop' : url ? '● Record again' : '● Record' }), (recording || url) && _jsx("span", { style: { fontVariantNumeric: 'tabular-nums', fontSize: 13 }, children: `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}` })] }), url && !recording && _jsx("audio", { controls: true, src: url, style: { width: '100%' } }), error && _jsx("p", { style: { ...muted, color: 'var(--theme-error-500)' }, children: error })] }));
};
