import type { GlobalConfig, PayloadRequest } from 'payload';
import type { VocalStackPluginOptions } from './types.js';
export declare const SETTINGS_SLUG = "vocalstack";
/**
 * Where a key connected from the admin lives. Nothing here is readable or
 * writable over the REST/GraphQL APIs: only the plugin's endpoints touch it
 * (with `overrideAccess`), so the key never reaches a browser.
 */
export declare const settingsGlobal: (options: VocalStackPluginOptions) => GlobalConfig;
export type StoredSettings = {
    account?: null | string;
    apiKey?: null | string;
    connectExpiresAt?: null | string;
    connectState?: null | string;
    connectVerifier?: null | string;
};
export declare function readSettings(req: PayloadRequest): Promise<StoredSettings>;
export declare function writeSettings(req: PayloadRequest, data: StoredSettings): Promise<void>;
/** The key to call VocalStack with: the plugin option first, then a connected one. */
export declare function resolveAPIKey(req: PayloadRequest, options: VocalStackPluginOptions): Promise<string | undefined>;
