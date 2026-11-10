import type { Endpoint } from 'payload';
import type { VocalStackPluginOptions } from '../types.js';
/** Semver order: below 0 when a is older than b. */
export declare function compareVersions(a: string, b: string): number;
export declare function versionEndpoint(options: VocalStackPluginOptions): Endpoint;
