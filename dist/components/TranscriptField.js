'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, TextareaInput, useField, useForm, useFormFields } from '@payloadcms/ui';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { paragraphs, timedTokens, transcriptText } from '../text.js';
import { BrandStyles } from './Brand.js';
const styles = `
  .vs-transcript { position: relative; max-height: 440px; overflow-y: auto; padding: 12px 16px; border: 1px solid var(--theme-elevation-150);
    border-radius: var(--style-radius-s, 4px); background: var(--theme-input-bg, var(--theme-elevation-0)); font-size: 15px; line-height: 1.75; }
  .vs-transcript p { margin: 0 0 .9em; }
  .vs-transcript p:last-child { margin-bottom: 0; }
  .vs-w { border-radius: 3px; margin: 0 -2px; padding: 0 2px; transition: background-color .12s, color .12s; }
  .vs-transcript--seekable .vs-w { cursor: pointer; }
  .vs-transcript--seekable .vs-w:hover { background: color-mix(in srgb, var(--vs-accent) 16%, transparent); }
  .vs-w--draft { color: var(--theme-elevation-500); }
  .vs-w--new { animation: vs-arrive 1.6s ease-out backwards; }
  .vs-w.vs-w--now { background: var(--vs-accent); color: #fff; }
  @keyframes vs-arrive {
    0% { opacity: 0; background: color-mix(in srgb, var(--vs-accent) 55%, transparent); }
    12% { opacity: 1; }
    100% { background: transparent; }
  }
  .vs-transcript-bar { align-items: center; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 8px; min-height: 28px; }
  .vs-transcript-hint { color: var(--theme-elevation-500); font-size: 13px; }
  .vs-live-dot { background: var(--vs-coral); border-radius: 50%; display: inline-block; height: 7px; margin-right: 6px; width: 7px; animation: vs-pulse 1.2s ease-in-out infinite; }
  @keyframes vs-pulse { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { .vs-w--new, .vs-live-dot { animation: none; } }
`;
/** One sentence as clickable, timed words. Re-renders only when VocalStack changes the sentence. */
const Sentence = memo(function Sentence({ freshAfter, sentence }) {
    let fresh = 0;
    return (_jsx(_Fragment, { children: timedTokens(sentence).map(([start, end, text], i) => {
            const isNew = start >= freshAfter;
            // New words arrive one after another, like they are being typed.
            const delay = isNew ? Math.min(fresh++ * 35, 700) : 0;
            return (_jsxs("span", { children: [_jsx("span", { className: `vs-w${sentence.draft ? ' vs-w--draft' : ''}${isNew ? ' vs-w--new' : ''}`, "data-e": end, "data-s": start, style: delay ? { animationDelay: `${delay}ms` } : undefined, children: text }), ' '] }, i));
        }) }));
}, (a, b) => a.sentence === b.sentence);
/** The audio this transcript belongs to: the player in the same array row, else our own. */
function findAudio(box, own) {
    return own ?? box.closest('.array-field__row')?.querySelector('audio') ?? null;
}
export const TranscriptField = ({ path }) => {
    const base = path.replace(/transcript$/, '');
    const { setValue, value } = useField({ path });
    const { dispatchFields } = useForm();
    const sentences = useFormFields(([fields]) => fields[`${base}sentences`]?.value);
    const status = useFormFields(([fields]) => fields[`${base}status`]?.value);
    // On an upload document the file is the audio; rows bring their own player.
    const inRow = /\.\d+\./.test(path);
    const fileURL = useFormFields(([fields]) => (inRow ? undefined : fields.url?.value));
    const [editing, setEditing] = useState(false);
    const [seekable, setSeekable] = useState(false);
    const box = useRef(null);
    const ownAudio = useRef(null);
    const words = useRef([]);
    const seenTo = useRef(null);
    const userScrolledAt = useRef(0);
    const processing = status === 'processing';
    const list = sentences ?? [];
    const generated = useMemo(() => transcriptText((sentences ?? []).filter((s) => !s.draft)), [sentences]);
    // Edited by hand: the words no longer match the timings, so show the text as written.
    const edited = !processing && Boolean(value) && value !== generated;
    const timed = list.length > 0 && (processing || !edited);
    // Words count as new (and animate) only past what was already on screen. On first
    // render everything is old; at the start of a transcription the slate is clean.
    if (!list.length)
        seenTo.current = 0;
    const freshAfter = seenTo.current ?? Number.POSITIVE_INFINITY;
    const lastEnd = list.length ? list[list.length - 1].end : 0;
    // Index the rendered words for the playhead, and keep a live transcript scrolled to its end.
    useLayoutEffect(() => {
        seenTo.current = Math.max(seenTo.current ?? 0, lastEnd);
        const el = box.current;
        if (!el)
            return;
        words.current = Array.from(el.querySelectorAll('.vs-w')).map((w) => ({ el: w, end: Number(w.dataset.e), start: Number(w.dataset.s) }));
        if (processing && Date.now() - userScrolledAt.current > 4000)
            el.scrollTop = el.scrollHeight;
    });
    // Follow the audio: highlight the word being spoken, without re-rendering React.
    useEffect(() => {
        const el = box.current;
        if (!el || !timed)
            return;
        const audio = findAudio(el, ownAudio.current);
        setSeekable(Boolean(audio));
        if (!audio)
            return;
        let raf = 0;
        let current = null;
        const at = (t) => {
            const list = words.current;
            let lo = 0;
            let hi = list.length - 1;
            let found = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (list[mid].start <= t) {
                    found = mid;
                    lo = mid + 1;
                }
                else
                    hi = mid - 1;
            }
            return found >= 0 && t <= list[found].end + 0.35 ? list[found].el : null;
        };
        const tick = () => {
            const word = at(audio.currentTime);
            if (word !== current) {
                current?.classList.remove('vs-w--now');
                word?.classList.add('vs-w--now');
                current = word;
                // Keep the spoken word in view, unless the editor is reading elsewhere.
                if (word && Date.now() - userScrolledAt.current > 4000) {
                    const top = word.offsetTop - el.offsetTop;
                    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 40)
                        el.scrollTo({ behavior: 'smooth', top: top - el.clientHeight / 3 });
                }
            }
            if (!audio.paused)
                raf = requestAnimationFrame(tick);
        };
        const start = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(tick);
        };
        audio.addEventListener('play', start);
        audio.addEventListener('seeked', tick);
        audio.addEventListener('timeupdate', tick);
        if (!audio.paused)
            start();
        return () => {
            cancelAnimationFrame(raf);
            current?.classList.remove('vs-w--now');
            audio.removeEventListener('play', start);
            audio.removeEventListener('seeked', tick);
            audio.removeEventListener('timeupdate', tick);
        };
    }, [timed, editing, fileURL]);
    /** Clear the transcript and its job, back to a fresh Transcribe. Saved with the document. */
    const remove = () => {
        if (!window.confirm('Delete this transcript? It is removed when you save.'))
            return;
        for (const name of ['sentences', 'language', 'error', 'recordingId', 'transcriptionId', 'transcribedAt']) {
            dispatchFields({ type: 'UPDATE', path: `${base}${name}`, value: null });
        }
        dispatchFields({ type: 'UPDATE', path: `${base}status`, value: 'idle' });
        setValue('');
        setEditing(false);
    };
    const seek = (e) => {
        const word = e.target.closest('.vs-w');
        const audio = box.current && findAudio(box.current, ownAudio.current);
        if (!word || !audio)
            return;
        audio.currentTime = Number(word.dataset.s);
        void audio.play().catch(() => undefined);
    };
    const noteScroll = () => {
        userScrolledAt.current = Date.now();
    };
    const hint = processing ? (_jsxs("span", { children: [_jsx("span", { className: "vs-live-dot" }), "Live from VocalStack"] })) : editing ? ('Editing. Transcribing again replaces your changes.') : edited ? ('Edited by hand, so words are no longer linked to the audio.') : timed && seekable ? ('Play the audio to follow along; click a word to jump there.') : null;
    return (_jsxs("div", { className: "field-type vs-brand", children: [_jsx(BrandStyles, {}), _jsx("style", { children: styles }), fileURL && _jsx("audio", { controls: true, preload: "none", ref: ownAudio, src: fileURL, style: { marginBottom: 8, width: '100%' } }), _jsxs("div", { className: "vs-transcript-bar", children: [_jsx("span", { className: "vs-transcript-hint", children: hint }), !processing && (_jsxs("span", { style: { display: 'flex', gap: 8 }, children: [editing && (value || list.length > 0) && (_jsx(Button, { buttonStyle: "error", margin: false, onClick: remove, size: "small", children: "Delete transcript" })), _jsx(Button, { buttonStyle: "secondary", margin: false, onClick: () => setEditing(!editing), size: "small", children: editing ? 'Done' : value || list.length > 0 ? 'Edit' : 'Write transcript' })] }))] }), editing ? (_jsx(TextareaInput, { onChange: (e) => setValue(e.target.value), path: path, rows: 14, value: value ?? '' })) : timed ? (_jsx("div", { className: `vs-transcript${seekable ? ' vs-transcript--seekable' : ''}`, onClick: seek, onTouchMove: noteScroll, onWheel: noteScroll, ref: box, children: paragraphs(list).map((p) => (_jsx("p", { children: p.map((s) => (_jsx(Sentence, { freshAfter: freshAfter, sentence: s }, s.draft ? 'draft' : s.id))) }, `${p[0].id ?? 'draft'}`))) })) : processing ? (
            // Not the previous transcript: that one is only replaced once this job is done.
            _jsx("p", { className: "vs-transcript-hint", style: { margin: 0 }, children: "The transcript appears here as VocalStack hears it." })) : value ? (_jsx("div", { className: "vs-transcript", ref: box, children: value.split(/\n{2,}/).map((p, i) => (_jsx("p", { children: p }, i))) })) : (_jsx("p", { className: "vs-transcript-hint", style: { margin: 0 }, children: "No transcript yet. Transcribe the audio, or write one yourself." }))] }));
};
