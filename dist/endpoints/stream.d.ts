import type { CollectionSlug, Endpoint } from 'payload';
import type { AudioFieldConfig, VocalStackPluginOptions } from '../types.js';
/**
 * GET /:id/vocalstack/stream: the job live, as Server-Sent Events. The server holds
 * the VocalStack subscribe socket (the API key never reaches the browser) and sends
 *   progress  { progress, phase, audio }        as it changes
 *   snapshot  { sentences }                      everything so far, once caught up
 *   sentence  { sentence } | { id, removed }     a settled sentence, new or rewritten
 *   draft     { words }                          words heard after the last settled sentence
 *   done | failed | stopped  (StatusResponse)    once, saved on the document; then it closes
 * Sentences carry their words as [start, end, text]. A dropped stream is resumed by
 * EventSource: it reconnects and gets a fresh snapshot.
 */
export declare function streamEndpoint(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint;
