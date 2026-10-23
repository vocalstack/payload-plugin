import type { CollectionSlug, Endpoint, Payload } from 'payload';
import type { AudioFieldConfig, VocalStackFieldData, VocalStackPluginOptions } from '../types.js';
/**
 * A document was read with readings still being made: bring them up to date after the
 * response, so a reading is ready for listeners without an editor watching it finish.
 */
export declare function refreshAfterRead(payload: Payload, collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], id: number | string, data: null | undefined | VocalStackFieldData, where?: {
    field: string;
    row: string;
}): void;
/**
 * Translations of a transcript, and spoken readings of them, on the same document or
 * row as the transcript (`?field=&row=` as for transcribing):
 *   POST   /:id/vocalstack/translate  { langs }          translate (call again while `more`)
 *   DELETE /:id/vocalstack/translate?lang=               drop a language, spoken reading too
 *   POST   /:id/vocalstack/speak      { langs, voice? }  read translations aloud
 *   GET    /:id/vocalstack/speak                         where the readings stand
 *   GET    /:id/vocalstack/audio?lang=                   public: the audio, or its reading in `lang`
 */
export declare function speechEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[];
