import type { CollectionConfig, CollectionSlug } from 'payload';
import type { VocalStackPluginOptions } from './types.js';
/** The upload collection finished readings are saved in, or none. */
export declare const readingsSlug: (options: VocalStackPluginOptions) => CollectionSlug | undefined;
/** Spoken readings, kept as MP3 uploads so they are served from the site's own storage. */
export declare const readingsCollection: (slug: CollectionSlug) => CollectionConfig;
