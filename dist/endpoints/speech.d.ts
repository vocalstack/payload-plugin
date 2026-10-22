import type { CollectionSlug, Endpoint } from 'payload';
import type { AudioFieldConfig, VocalStackPluginOptions } from '../types.js';
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
