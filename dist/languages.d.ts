import type { PayloadRequest } from 'payload';
import type { ListenerOptions, VocalStackPluginOptions } from './types.js';
import { type Languages } from './api.js';
/** The most languages one recording is translated or read into, besides its spoken one (VocalStack's limit). */
export declare const LANGUAGE_LIMIT = 10;
/**
 * What VocalStack translates and reads aloud: asked now and then, and remembered. While
 * VocalStack cannot be asked, the last answer (or the list shipped with the plugin) stands in,
 * so a site never loses its language list to an outage.
 */
export declare function languageList(req: PayloadRequest, options: VocalStackPluginOptions): Promise<Languages>;
/** The listener options, or nothing when listeners may not ask for languages. */
export declare const listenerOptions: (options: VocalStackPluginOptions) => ListenerOptions | undefined;
/** The languages listeners are offered: VocalStack's, narrowed to the site's own list when it has one. */
export declare function forListeners(all: Languages, listeners: ListenerOptions): Languages;
/** Whether this visitor may ask for another new language now; counts it when so. */
export declare function allowNewLanguage(req: PayloadRequest, perHour: number): boolean;
