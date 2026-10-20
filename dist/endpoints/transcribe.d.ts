import type { CollectionSlug, Endpoint, PayloadRequest } from 'payload';
import type { AudioFieldConfig, StatusResponse, TranscriptSentence, VocalStackFieldData, VocalStackPluginOptions } from '../types.js';
import { type Transcript, VocalStackAPI } from '../api.js';
/** One transcribable thing: an upload document, or one row of an array field. */
export type Target = {
    data: VocalStackFieldData;
    fileName: string;
    name: string;
    save: (patch: VocalStackFieldData) => Promise<VocalStackFieldData>;
    url: () => Promise<string | undefined>;
};
export declare function locate(req: PayloadRequest, collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], readAs: 'admin' | 'user'): Promise<Response | Target>;
/** A transcript's sentences, each with its words. */
export declare function toSentences(t: Pick<Transcript, 'segments' | 'sentences'>): TranscriptSentence[];
export declare function apiError(err: unknown): Response;
/**
 * Where a job stands, saving the outcome on the document once it is over: the
 * whole transcript when done, the reason when it failed.
 */
export declare function checkJob(api: VocalStackAPI, target: Target, recordingId: string): Promise<StatusResponse>;
/**
 * POST /:id/vocalstack/transcribe and GET /:id/vocalstack/status. With no query
 * they act on the upload document itself; with `?field=<array>&row=<row id>` on one row.
 */
export declare function transcribeEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[];
