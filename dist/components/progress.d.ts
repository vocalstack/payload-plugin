import type { JobProgress } from '../types.js';
export declare function setJobs(collection: string, next: JobProgress[]): void;
/**
 * Where a document's transcription stands while it runs: `{ phase, progress }` (phase
 * `queued`, `fetching`, `transcribing` or `finalizing`; progress 0–100), or undefined when
 * nothing of it is running (or the list has not asked yet). With several audio files
 * running, the one furthest behind.
 */
export declare function useTranscriptionProgress(collection: string, id: number | string | undefined): Pick<JobProgress, 'phase' | 'progress'> | undefined;
