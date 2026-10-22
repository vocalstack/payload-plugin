import type { Plugin } from 'payload';
import type { VocalStackPluginOptions, VoiceFieldData } from './types.js';
export type * from './types.js';
export { spokenSentences, timedTokens, transcriptText } from './text.js';
/** The voice to read translations in (`clone:<id>`), once a person's cloned voice is ready. */
export declare const clonedVoiceKey: (data?: null | VoiceFieldData) => string | undefined;
export declare const vocalstackPlugin: (options?: VocalStackPluginOptions) => Plugin;
