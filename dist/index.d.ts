import type { Plugin } from 'payload';
import type { VocalStackPluginOptions } from './types.js';
export type * from './types.js';
export { spokenSentences, timedTokens, transcriptText } from './text.js';
export { migrateSpeakerFields, speakerData } from './endpoints/voices.js';
export declare const vocalstackPlugin: (options?: VocalStackPluginOptions) => Plugin;
