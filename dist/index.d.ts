import type { Plugin } from 'payload';
import type { VocalStackPluginOptions } from './types.js';
export type * from './types.js';
export { timedTokens, transcriptText } from './text.js';
export declare const vocalstackPlugin: (options?: VocalStackPluginOptions) => Plugin;
