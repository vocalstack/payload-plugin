import type { Endpoint } from 'payload';
import type { VoiceCollectionConfig, VocalStackPluginOptions } from '../types.js';
/**
 * A person's cloned voice, kept in the `vocalstackVoice` group of their document:
 *   GET    /:id/vocalstack/voice            where its training stands
 *   POST   /:id/vocalstack/voice            clone it: JSON { recordingId, startS, endS, consent },
 *                                           or multipart with a `file` sample and `_payload` { consent }
 *   DELETE /:id/vocalstack/voice            delete it, in VocalStack too
 *   GET    /:id/vocalstack/voice/sources    recordings to take the sample from
 *   GET    /:id/vocalstack/voice/clip       a stretch of one of them, to hear before cloning (?recording=&startS=&endS=)
 *   GET    /:id/vocalstack/voice/preview    the voice speaking (?lang=&format=ogg|caf)
 * A sample is only ever taken from the recordings `config.recordings` offers for that document.
 */
export declare function voiceEndpoints(config: VoiceCollectionConfig, options: VocalStackPluginOptions): Endpoint[];
/**
 * Shared admin lookups (signed in, and `options.access` when set):
 *   GET /vocalstack/languages                      what can be translated and spoken
 *   GET /vocalstack/voices?lang=&recording=        voices that can speak a language
 */
export declare function lookupEndpoints(options: VocalStackPluginOptions): Endpoint[];
