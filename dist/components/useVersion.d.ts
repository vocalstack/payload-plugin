import type { VersionResponse } from '../types.js';
/** This plugin's version against the newest on npm (the server asks npm, and keeps the answer). */
export declare function useVersion(): VersionResponse | undefined;
