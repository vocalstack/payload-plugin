import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload';
import type { ArrayRow, AudioFieldConfig, StatusResponse, TranscriptSentence, VocalStackFieldData, VocalStackPluginOptions } from '../types.js';
import { type Job, type Transcript, type Transcription, VocalStackAPI } from '../api.js';
/** Whether the signed-in user may update this document, by the collection's own `access.update`. */
export declare function canUpdate(req: PayloadRequest, collection: CollectionSlug, id: number | string): Promise<boolean>;
type Patch = ((current: VocalStackFieldData) => VocalStackFieldData) | VocalStackFieldData;
/** One transcribable thing: an upload document, or one row of an array field. */
export type Target = {
    data: VocalStackFieldData;
    doc: Record<string, unknown>;
    fileName: string;
    name: string;
    /** Set when the target is a row of an array field. */
    row?: ArrayRow;
    /** Merge into the saved field: a patch, or one made from the field as it is saved now. */
    save: (patch: Patch) => Promise<VocalStackFieldData>;
    url: () => Promise<string | undefined>;
};
export declare function locate(req: PayloadRequest, collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], readAs: 'admin' | 'user'): Promise<Response | Target>;
/** A transcript's sentences, each with its words. */
export declare function toSentences(t: Pick<Transcript, 'segments' | 'sentences'>): TranscriptSentence[];
export declare function apiError(err: unknown): Response;
/** Start a job for the target's file: by link when VocalStack can fetch it, otherwise (or when `asFile`) by sending the bytes. */
export declare function startJob(req: PayloadRequest, api: VocalStackAPI, target: Target, call: {
    idempotencyKey: string;
    name: string;
    spokenLanguage?: string;
}, asFile?: boolean): Promise<Transcription & {
    job: Job;
}>;
/** Sends the file's bytes in place of a link VocalStack could not use; the new job is saved on the target. */
export declare function refileWith(req: PayloadRequest, api: VocalStackAPI, target: Target, collection: CollectionSlug, spokenLanguage?: string): () => Promise<StatusResponse>;
/**
 * Where a job stands, saving the outcome on the document once it is over: the
 * whole transcript when done, the reason when it failed. With `refile`, a job whose
 * link failed (see REFILE_CODES) is started again from the file's bytes.
 */
export declare function checkJob(api: VocalStackAPI, target: Target, transcriptionId: string, refile?: () => Promise<StatusResponse>): Promise<StatusResponse>;
/**
 * POST /:id/vocalstack/transcribe and GET /:id/vocalstack/status. With no query
 * they act on the upload document itself; with `?field=<array>&row=<row id>` on one row.
 */
export declare function transcribeEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[];
export {};
