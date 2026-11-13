import type { CollectionSlug, Endpoint, Payload, PayloadRequest } from 'payload';
import type { SpeakerCollectionConfig, SpeakerFieldData, VocalStackPluginOptions, VoiceFieldData } from '../types.js';
export declare const PICK_MIN_S = 5;
export declare const PICK_MAX_S = 60;
/** The document's saved speaker: the `vocalstackSpeaker` group, else the `vocalstackVoice` group of 0.5 and earlier. */
export declare function speakerData(doc: Record<string, unknown>): SpeakerFieldData;
/** Copy every document's `vocalstackVoice` group (0.5) into `vocalstackSpeaker`, e.g. from a Payload migration. Answers how many moved. */
export declare function migrateSpeakerFields({ collection, payload, req }: {
    collection: CollectionSlug;
    payload: Payload;
    req?: PayloadRequest;
}): Promise<number>;
export declare const legacyVoiceData: ({ cloneId, speakerId, ...rest }: SpeakerFieldData) => VoiceFieldData;
/**
 * A person saved as a VocalStack speaker, with their cloned voice, kept in the `vocalstackSpeaker` group of their document:
 *   GET    /:id/vocalstack/speaker            where its voice's training stands
 *   POST   /:id/vocalstack/speaker            save and clone them: JSON { transcriptionId, startS, endS, consent },
 *                                             or multipart with a `file` sample and `_payload` { consent }
 *   DELETE /:id/vocalstack/speaker            delete it, and its voice, in VocalStack too
 *   GET    /:id/vocalstack/speaker/sources    transcriptions to take the sample from
 *   GET    /:id/vocalstack/speaker/clip       a stretch of one of them, to hear before cloning (?transcription=&startS=&endS=)
 *   GET    /:id/vocalstack/speaker/preview    the voice speaking (?lang=&format=ogg|caf)
 *   POST   /:id/vocalstack/speaker/trial      a trial from picked sentences { transcriptionId, speaker, spans, replace? }
 *   GET    /:id/vocalstack/speaker/trial      ?voice= where it stands; …/trial/preview?voice=&lang=&format= hear it
 *   POST   /:id/vocalstack/speaker/trial/keep { voice, name, consent } keep it as their speaker; DELETE …/trial?voice= drop it
 * Each also answers under /:id/vocalstack/voice…, its path in 0.5.
 * A sample is only ever taken from the transcriptions `config.transcriptions` offers for that document.
 */
export declare function speakerEndpoints(config: SpeakerCollectionConfig, options: VocalStackPluginOptions): Endpoint[];
/**
 * Shared lookups:
 *   GET /vocalstack/languages                      what can be translated and spoken (public with `listeners` on)
 *   GET /vocalstack/voices?lang=&recording=        voices that can speak a language (signed in, and `options.access`)
 */
export declare function lookupEndpoints(options: VocalStackPluginOptions): Endpoint[];
