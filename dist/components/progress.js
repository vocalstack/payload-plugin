'use client';
import { useSyncExternalStore } from 'react';
/**
 * Running jobs by collection, as the list's last settle reported them. The list's
 * Transcribe bar fills it; any cell in the list can read its row's job with
 * `useTranscriptionProgress`.
 */
const jobs = new Map();
const listeners = new Set();
export function setJobs(collection, next) {
    jobs.set(collection, next);
    for (const l of listeners)
        l();
}
const subscribe = (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
};
/**
 * Where a document's transcription stands while it runs: `{ phase, progress }` (phase
 * `queued`, `fetching`, `transcribing` or `finalizing`; progress 0–100), or undefined when
 * nothing of it is running (or the list has not asked yet). With several audio files
 * running, the one furthest behind.
 */
export function useTranscriptionProgress(collection, id) {
    const key = useSyncExternalStore(subscribe, () => {
        if (id === undefined)
            return '';
        const mine = (jobs.get(collection) ?? []).filter((j) => String(j.id) === String(id));
        if (!mine.length)
            return '';
        const behind = mine.reduce((a, b) => (b.progress < a.progress ? b : a));
        return `${behind.phase}|${behind.progress}`;
    }, () => '');
    if (!key)
        return undefined;
    const [phase, progress] = key.split('|');
    return { phase, progress: Number(progress) };
}
