import type { CollectionSlug, Endpoint, Payload } from 'payload';
import type { AudioFieldConfig, Translation, VocalStackFieldData, VocalStackPluginOptions } from '../types.js';
/** Whether a language is fully translated (older translations, made before `pending`, are). */
export declare const isTranslated: (t: null | Translation | undefined) => boolean;
/**
 * A document was read with work still left on its languages: carry it forward after the
 * response, so a translation or reading is ready for listeners without an editor watching.
 */
export declare function refreshAfterRead(payload: Payload, collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[], id: number | string, data: null | undefined | VocalStackFieldData, where?: {
    field: string;
    row: string;
}): void;
/**
 * Translations of a transcript, and spoken readings of them, on the same document or
 * row as the transcript (`?field=&row=` as for transcribing):
 *   POST   /:id/vocalstack/translate  { langs }                  translate (call again while `more`)
 *   DELETE /:id/vocalstack/translate?lang=                       drop a language, spoken reading too
 *   POST   /:id/vocalstack/voices     { voices }                 'cloned' or 'synthetic', for readings from now on
 *   POST   /:id/vocalstack/request    { langs, speak? }          translate and read aloud, carried on by the server
 *   POST   /:id/vocalstack/speak      { langs }                  read translations aloud (VocalStack picks the voice)
 *   GET    /:id/vocalstack/speak                                 where the readings stand
 *   GET    /:id/vocalstack/audio?lang=                           public: the audio, or its reading in `lang`
 * With `listeners` on, for anyone who may read the document:
 *   GET    /:id/vocalstack/listen?lang=                          where a language stands
 *   POST   /:id/vocalstack/listen     { lang }                   ask for a language
 */
export declare function speechEndpoints(collection: CollectionSlug, options: VocalStackPluginOptions, rowFields: AudioFieldConfig[]): Endpoint[];
