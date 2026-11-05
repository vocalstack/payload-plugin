import { DEFAULT_API_URL, VocalStackAPI } from './api.js';
import { LANGUAGES_SNAPSHOT } from './languagesSnapshot.js';
import { resolveAPIKey } from './settings.js';
/** The most languages one recording is translated or read into, besides its spoken one (VocalStack's limit). */
export const LANGUAGE_LIMIT = 10;
let cached;
const FRESH_MS = 3600_000;
/**
 * What VocalStack translates and reads aloud: asked now and then, and remembered. While
 * VocalStack cannot be asked, the last answer (or the list shipped with the plugin) stands in,
 * so a site never loses its language list to an outage.
 */
export async function languageList(req, options) {
    if (cached && Date.now() - cached.at < FRESH_MS)
        return cached.value;
    try {
        const apiKey = await resolveAPIKey(req, options);
        if (!apiKey)
            return cached?.value ?? LANGUAGES_SNAPSHOT;
        const value = await new VocalStackAPI(apiKey, options.apiURL ?? DEFAULT_API_URL).languages();
        if (value?.languages?.length)
            cached = { at: Date.now(), value };
        return cached?.value ?? LANGUAGES_SNAPSHOT;
    }
    catch {
        // Ask again in a few minutes rather than on every request.
        if (cached)
            cached = { ...cached, at: Date.now() - FRESH_MS + 300_000 };
        return cached?.value ?? LANGUAGES_SNAPSHOT;
    }
}
/** The listener options, or nothing when listeners may not ask for languages. */
export const listenerOptions = (options) => !options.listeners ? undefined : options.listeners === true ? {} : options.listeners;
/** The languages listeners are offered: VocalStack's, narrowed to the site's own list when it has one. */
export function forListeners(all, listeners) {
    if (!listeners.languages?.length)
        return all;
    const allowed = new Set(listeners.languages.map((l) => l.toLowerCase()));
    const languages = all.languages.filter((l) => allowed.has(l.code));
    return {
        languages,
        translation: languages.filter((l) => l.translation).map((l) => l.code),
        voice: languages.filter((l) => l.voice).map((l) => l.code),
    };
}
/** New languages asked for, by visitor, this hour (on this server). */
const asked = new Map();
/** Whether this visitor may ask for another new language now; counts it when so. */
export function allowNewLanguage(req, perHour) {
    const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'unknown').trim();
    const now = Date.now();
    const recent = (asked.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= perHour) {
        asked.set(ip, recent);
        return false;
    }
    recent.push(now);
    asked.set(ip, recent);
    if (asked.size > 5000)
        for (const [k, v] of asked)
            if (!v.some((t) => now - t < 3600_000))
                asked.delete(k);
    return true;
}
