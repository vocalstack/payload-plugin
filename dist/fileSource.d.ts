import type { CollectionSlug, PayloadRequest } from 'payload';
import type { UploadDoc, VocalStackPluginOptions } from './types.js';
/** The absolute address of an upload's file. */
export declare function resolveFileURL(req: PayloadRequest, collection: CollectionSlug, doc: UploadDoc, options: VocalStackPluginOptions): Promise<string | undefined>;
/**
 * Whether VocalStack can fetch this address itself. The API refuses loopback,
 * private and link-local hosts, so for those (local development, an intranet)
 * the plugin sends the bytes instead.
 */
export declare function isPublicURL(url: string): boolean;
/** The file's bytes, for an upload VocalStack cannot reach by link. */
export declare function fetchFile(req: PayloadRequest, url: string): Promise<Blob>;
