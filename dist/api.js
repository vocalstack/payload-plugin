/**
 * The VocalStack API calls the plugin needs, made through the VocalStack JS SDK
 * (`@vocalstack/js-sdk`). This adapter keeps the plugin's own shapes and one error
 * type, so an engine that is down reads the same everywhere.
 * Contract: https://api.vocalstack.com/v1/openapi.json
 */
import { VocalStack, VocalStackError } from '@vocalstack/js-sdk';
export const DEFAULT_API_URL = 'https://api.vocalstack.com';
export const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com';
export const UNAVAILABLE = 'VocalStack is unavailable, try again shortly.';
export class VocalStackAPIError extends Error {
    code;
    status;
    constructor(status, code, message) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
/** How long a call may take before VocalStack counts as unavailable. Translating and cloning are slow. */
function timeoutFor(url, method = 'GET') {
    const path = new URL(url).pathname;
    if (path.endsWith('/translation'))
        return 180_000;
    if (method === 'POST' && path === '/v1/voices')
        return 120_000;
    if (path.endsWith('/audio/clip') || path.endsWith('/preview'))
        return 60_000;
    return 30_000;
}
/** One error type: an engine that is down or slow (an upgrade, an outage) is `unavailable`. */
function toAPIError(err) {
    if (err instanceof VocalStackAPIError)
        return err;
    if (err instanceof VocalStackError) {
        const down = err.code === 'unavailable' || (err.code === 'internal' && (err.status === 502 || err.status === 503 || err.status === 504));
        if (down)
            return new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        return new VocalStackAPIError(err.status ?? 500, err.code, err.message);
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
        return new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
    return new VocalStackAPIError(500, 'http_error', err instanceof Error ? err.message : String(err));
}
const call = async (run) => {
    try {
        return await run();
    }
    catch (err) {
        throw toAPIError(err);
    }
};
export class VocalStackAPI {
    sdk;
    constructor(apiKey, baseURL = DEFAULT_API_URL) {
        this.sdk = new VocalStack({
            apiKey,
            baseUrl: baseURL,
            // One retry of a busy or restarting API; the admin and listeners ask again anyway.
            maxRetries: 1,
            fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutFor(String(input instanceof Request ? input.url : input), init?.method)) }),
        });
    }
    me() {
        return call(() => this.sdk.me.get());
    }
    transcribeURL(url, opts) {
        return call(() => this.sdk.transcriptions.create({ name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined, url }, { idempotencyKey: opts.idempotencyKey }));
    }
    transcribeFile(file, fileName, opts) {
        return call(() => this.sdk.transcriptions.create({ file, fileName, name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined }, { idempotencyKey: opts.idempotencyKey }));
    }
    job(recordingId) {
        return call(() => this.sdk.jobs.get(recordingId));
    }
    /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
    stop(recordingId, reason) {
        return call(() => this.sdk.recordings.stop(recordingId, reason));
    }
    transcript(recordingId) {
        return call(() => this.sdk.recordings.transcript(recordingId));
    }
    /**
     * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
     * answers only the sentences it translates in that call, so stored ones are read here.
     */
    async storedTranslations(recordingId, lang) {
        const t = (await call(() => this.sdk.recordings.transcript(recordingId, { lang })));
        const out = {};
        for (const s of t.sentences ?? []) {
            const text = s.translations?.[lang];
            if (text?.trim())
                out[String(s.sentenceId)] = text;
        }
        return out;
    }
    languages() {
        return call(() => this.sdk.languages.list());
    }
    /** Sentences translated into `lang`, by sentence id. Untranslated ones are translated now, which takes a while. */
    translation(recordingId, lang, sentenceIds) {
        return call(() => this.sdk.recordings.translation(recordingId, lang, sentenceIds));
    }
    /**
     * Render spoken translations, one job per language, in the recording's default cast: VocalStack
     * picks each speaker's voice. `cloned` lets it use speakers' own cloned voices (each made with
     * that speaker's permission); otherwise it reads in stock voices.
     */
    async speak(recordingId, langs, opts = {}) {
        const render = (body) => call(() => this.sdk.recordings.renderVoice(recordingId, body));
        try {
            return await render({ langs, voice: opts.cloned ? 'cloned' : 'synthetic' });
        }
        catch (err) {
            // An API from before `voice: 'synthetic' | 'cloned'` takes it for a voice id: there, consent turns clones on.
            if (!(err instanceof VocalStackAPIError && err.status === 400 && /no voice '(cloned|synthetic)'/.test(err.message)))
                throw err;
            return render({ consent: opts.cloned ? true : undefined, langs });
        }
    }
    voiceTracks(recordingId, lang) {
        return call(() => this.sdk.recordings.voice(recordingId, lang));
    }
    /** An address of the recording's audio, or of a spoken translation's, that works for an hour or so. */
    async audioURL(recordingId, opts) {
        const format = opts.format ?? 'mp3';
        if (opts.kind === 'delivery')
            return call(() => this.sdk.recordings.audioUrl(recordingId, { format, kind: 'delivery' }));
        // A reading in a named voice: a short-lived media token carries the voice in the address.
        const { token } = await call(() => this.sdk.recordings.mediaToken(recordingId));
        return this.sdk.recordings.audioSrc(recordingId, { format, kind: 'voice', lang: opts.lang, media: token, voice: opts.voice });
    }
    /** A stretch of the recording as WAV (16 kHz mono), at most 120 s. */
    clip(recordingId, startS, endS) {
        return call(() => this.sdk.recordings.clip(recordingId, startS, endS));
    }
    voice(id) {
        return call(() => this.sdk.voices.get(id));
    }
    /** Clone a voice from a recorded sample (30 s or more). Needs the speaker's permission. */
    createVoice(sample, fileName, meta, idempotencyKey) {
        return call(() => this.sdk.voices.create({ ...meta, fileName, sample }, { idempotencyKey }));
    }
    /**
     * Clone a speaker's voice from stretches of a transcribed recording (5–60 s in all). `draft`
     * makes a trial voice to hear first; keep it with `keepVoice`, or delete it.
     */
    voiceFromSpeaker(opts, idempotencyKey) {
        return call(() => this.sdk.voices.createFromSpeaker({ ...opts, consent: true, library: false }, { idempotencyKey }));
    }
    /** Keep a trial voice, as `name`, with the speaker's permission. */
    keepVoice(id, name) {
        return call(() => this.sdk.voices.update(id, { consent: true, draft: false, name }));
    }
    deleteVoice(id) {
        return call(() => this.sdk.voices.delete(id));
    }
    availableVoices(lang, recordingId) {
        return call(() => this.sdk.voices.available(lang, { recording: recordingId }));
    }
    /** The cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
    voicePreview(id, lang, format = 'ogg') {
        return call(() => this.sdk.voices.clonePreview(id, { format, lang }));
    }
}
/** A short label for the connected account, from whatever `/v1/me` carries. */
export function accountLabel(me) {
    const pick = (o, ...keys) => {
        if (!o || typeof o !== 'object')
            return undefined;
        for (const k of keys) {
            const v = o[k];
            if (typeof v === 'string' && v)
                return v;
        }
    };
    return pick(me.principal, 'name', 'displayName') ?? pick(me.organization, 'name') ?? pick(me.user, 'email', 'name') ?? pick(me, 'email', 'name', 'displayName');
}
