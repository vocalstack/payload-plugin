import type { CollectionSlug, Endpoint } from 'payload';
import type { AudioFieldConfig, VocalStackPluginOptions } from '../types.js';
/** Documents one call may start; the admin sends a long selection in batches, so each request stays short. */
export declare const BULK_BATCH = 25;
/**
 * POST /api/<collection>/vocalstack/transcribe-many { ids } starts a transcription for each
 * audio file of each document (the upload itself, or every audio row). Files already
 * transcribed or being transcribed are skipped. At most BULK_BATCH documents per call.
 *
 * POST /api/<collection>/vocalstack/settle saves every job of the collection that has
 * finished, so transcriptions started from the list are kept without anyone opening them.
 */
export declare function bulkEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], isUpload: boolean): Endpoint[];
