import type { Endpoint } from 'payload';
import type { VoiceCollectionConfig, VocalStackPluginOptions } from '../types.js';
export declare const PICK_MIN_S = 5;
export declare const PICK_MAX_S = 60;
/**
 * A person's cloned voice, kept in the `vocalstackVoice` group of their document:
 *   GET    /:id/vocalstack/voice            where its training stands
 *   POST   /:id/vocalstack/voice            clone it: JSON { recordingId, startS, endS, consent },
 *                                           or multipart with a `file` sample and `_payload` { consent }
 *   DELETE /:id/vocalstack/voice            delete it, in VocalStack too
 *   GET    /:id/vocalstack/voice/sources    recordings to take the sample from
 *   GET    /:id/vocalstack/voice/clip       a stretch of one of them, to hear before cloning (?recording=&startS=&endS=)
 *   GET    /:id/vocalstack/voice/preview    the voice speaking (?lang=&format=ogg|caf)
 *   POST   /:id/vocalstack/voice/trial      a trial voice from picked sentences { recordingId, speaker, spans, replace? }
 *   GET    /:id/vocalstack/voice/trial      ?voice= where it stands; …/trial/preview?voice=&lang=&format= hear it
 *   POST   /:id/vocalstack/voice/trial/keep { voice, name, consent } keep it as their voice; DELETE …/trial?voice= drop it
 * A sample is only ever taken from the recordings `config.recordings` offers for that document.
 */
export declare function voiceEndpoints(config: VoiceCollectionConfig, options: VocalStackPluginOptions): Endpoint[];
/**
 * Shared lookups:
 *   GET /vocalstack/languages                      what can be translated and spoken (public with `listeners` on)
 *   GET /vocalstack/voices?lang=&recording=        voices that can speak a language (signed in, and `options.access`)
 */
export declare function lookupEndpoints(options: VocalStackPluginOptions): Endpoint[];
