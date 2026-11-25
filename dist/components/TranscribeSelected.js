'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button, ConfirmationModal, toast, useModal, useSelection } from '@payloadcms/ui';
import { useRouter } from 'next/navigation.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandStyles, Mark } from './Brand.js';
import { setJobs } from './progress.js';
import { useAPI } from './useConnection.js';
/** `SelectAllStatus.AllAvailable`: "Select all" across every page of the list. */
const ALL = 'allAvailable';
/** Documents per request; the server takes at most this many. */
const BATCH = 25;
/** How often the list asks how running jobs are doing (and saves finished ones). */
const SETTLE_MS = 5_000;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/**
 * Above a list of transcribable documents: [V Transcribe] for the selected rows. While the list is open, finished jobs are saved on their
 * documents (and the list refreshed), so no one has to open each one.
 */
export const TranscribeSelected = ({ collection }) => {
    const call = useAPI();
    const router = useRouter();
    const { count, getQueryParams, selectAll, selectedIDs, toggleAll } = useSelection();
    const { openModal } = useModal();
    const modalSlug = `vocalstack-transcribe-${collection}`;
    const [starting, setStarting] = useState();
    const timer = useRef(undefined);
    const settle = useCallback(async () => {
        clearTimeout(timer.current);
        try {
            const r = await call(`/${collection}/vocalstack/settle`, { method: 'POST' });
            setJobs(collection, r.jobs ?? []);
            if (r.finished || r.failed)
                router.refresh();
            if (r.failed)
                toast.error(`${plural(r.failed, 'transcription')} failed. Open the document to see why.`);
            if (r.processing)
                timer.current = setTimeout(settle, SETTLE_MS);
        }
        catch {
            // Not signed in any more, or the server is away: try again later.
            timer.current = setTimeout(settle, SETTLE_MS * 6);
        }
    }, [call, collection, router]);
    useEffect(() => {
        void settle();
        return () => clearTimeout(timer.current);
    }, [settle]);
    /** Every selected id; with "Select all" across pages, the ids the list's filter matches. */
    const ids = useCallback(async () => {
        if (selectAll !== ALL)
            return selectedIDs;
        const params = getQueryParams();
        const { docs } = await call(`/${collection}${params}${params ? '&' : '?'}depth=0&pagination=false&select[id]=true`, { method: 'GET' });
        return docs.map((d) => d.id);
    }, [call, collection, getQueryParams, selectAll, selectedIDs]);
    const start = useCallback(async () => {
        const all = await ids();
        const total = { failed: [], notStarted: 0, skipped: { done: 0, noAudio: 0, processing: 0 }, started: 0 };
        setStarting({ done: 0, total: all.length });
        try {
            for (let i = 0; i < all.length && !total.stopped; i += BATCH) {
                const r = await call(`/${collection}/vocalstack/transcribe-many`, { body: JSON.stringify({ ids: all.slice(i, i + BATCH) }), method: 'POST' });
                total.started += r.started;
                total.notStarted += r.notStarted;
                total.failed.push(...r.failed);
                for (const k of ['done', 'noAudio', 'processing'])
                    total.skipped[k] += r.skipped[k];
                total.stopped = r.stopped;
                setStarting({ done: Math.min(i + BATCH, all.length), total: all.length });
            }
        }
        catch (err) {
            total.stopped = { error: err.message };
        }
        finally {
            setStarting(undefined);
        }
        const skipped = [
            total.skipped.done && `${total.skipped.done} already transcribed`,
            total.skipped.processing && `${total.skipped.processing} already in progress`,
            total.skipped.noAudio && `${plural(total.skipped.noAudio, 'without audio', 'without audio')}`,
        ].filter(Boolean);
        const summary = [`Started ${plural(total.started, 'transcription')}.`, skipped.length ? `Skipped: ${skipped.join(', ')}.` : ''].join(' ').trim();
        if (total.stopped)
            toast.error(`${total.stopped.error}${total.started ? ` ${summary}` : ''}`);
        else if (total.failed.length)
            toast.warning(`${summary} ${plural(total.failed.length, 'file')} could not be started: ${total.failed[0].error}`);
        else
            toast.success(summary);
        if (total.started) {
            toggleAll(false);
            router.refresh();
            void settle();
        }
    }, [call, collection, ids, router, settle, toggleAll]);
    if (!count && !starting)
        return null;
    const howMany = selectAll === ALL ? 'every matching document' : plural(count, 'selected document');
    return (_jsxs("div", { className: "vs-brand", style: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--base) * 0.75)', marginBottom: 'calc(var(--base) * 0.75)' }, children: [_jsx(BrandStyles, {}), count > 0 && (_jsx(Button, { buttonStyle: "secondary", disabled: Boolean(starting), margin: false, onClick: () => openModal(modalSlug), size: "small", tooltip: `Transcribe ${howMany} with VocalStack`, children: _jsxs("span", { style: { alignItems: 'center', display: 'inline-flex', gap: 6 }, children: [_jsx(Mark, { height: 12 }), starting ? `Starting ${starting.done} of ${starting.total}…` : 'Transcribe'] }) })), _jsx(ConfirmationModal, { body: _jsxs("p", { children: ["Transcribe the audio of ", howMany, " with VocalStack. Files already transcribed or in progress are skipped. Your VocalStack workspace is billed for each transcription."] }), confirmLabel: "Transcribe", heading: "Transcribe with VocalStack", modalSlug: modalSlug, onConfirm: () => void start() })] }));
};
