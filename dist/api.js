/**
 * The VocalStack API calls the plugin needs, made through the VocalStack JS SDK
 * (`@vocalstack/js-sdk`). This adapter keeps the plugin's own shapes and one error
 * type, so an engine that is down reads the same everywhere.
 * Contract: https://api.vocalstack.com/v1/openapi.json
 */
import { VocalStack, VocalStackError } from '@vocalstack/js-sdk';
export const DEFAULT_API_URL = 'https://api.vocalstack.com';
export const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com';
function savedSpeakerOf(raw) {
    const clone = 'voice' in raw ? (raw.voice ?? null) : raw;
    return {
        cloneId: clone?.id ?? null,
        createdAt: raw.createdAt,
        draft: raw.draft ?? clone?.draft,
        error: clone?.error ?? null,
        id: raw.id,
        name: raw.name,
        progress: clone?.progress ?? 0,
        sampleS: clone?.sampleS ?? 0,
        state: clone?.state ?? 'none',
    };
}
const speakerRoutes = new Map();
const both = (rest) => ({ speakers: `/v1/speakers${rest}`, voices: `/v1/voices${rest}` });
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
    if (method === 'POST' && (path === '/v1/speakers' || path === '/v1/voices'))
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
    #apiKey;
    #baseURL;
    constructor(apiKey, baseURL = DEFAULT_API_URL) {
        this.#apiKey = apiKey;
        this.#baseURL = baseURL.replace(/\/+$/, '');
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
     * Read translations aloud, one job per language. `cloned` reads each speaker in their own cloned
     * voice where VocalStack can use one (a clone of that speaker, made with their permission, or the
     * clone of a saved speaker VocalStack recognised as them) and in a stock voice otherwise; `synthetic` reads
     * everyone in stock voices. Each track says which it got (`voices`: cloned, synthetic or mixed).
     * A clone only ever reads words its own speaker said.
     */
    async speak(recordingId, langs, as = { cloned: false }) {
        const ask = { langs, voices: as.cloned ? 'cloned' : 'synthetic' };
        // Straight to the API: the SDK on npm (2.0.0-alpha.1) leaves `voices` out of the body.
        const res = await call(() => fetch(`${this.#baseURL}/v1/recordings/${encodeURIComponent(recordingId)}/voice`, {
            body: JSON.stringify(ask),
            headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
            method: 'POST',
            signal: AbortSignal.timeout(30_000),
        }));
        const body = (await res.json().catch(() => null));
        if (res.ok)
            return body;
        if (res.status === 502 || res.status === 503 || res.status === 504)
            throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        throw new VocalStackAPIError(res.status, body?.code ?? 'http_error', body?.message ?? `VocalStack answered ${res.status}`);
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
    async #speakerRequest(method, paths, init = {}) {
        const first = speakerRoutes.get(this.#baseURL) ?? 'speakers';
        const order = first === 'speakers' ? ['speakers', 'voices'] : ['voices', 'speakers'];
        const query = Object.entries(init.query ?? {}).filter((e) => e[1] !== undefined);
        const qs = query.length ? `?${new URLSearchParams(query)}` : '';
        let last;
        for (const route of order) {
            const path = paths[route];
            if (!path)
                continue;
            const url = `${this.#baseURL}${path}${qs}`;
            const headers = { accept: init.audio ? '*/*' : 'application/json', authorization: `Bearer ${this.#apiKey}` };
            if (init.body)
                headers['content-type'] = 'application/json';
            if (init.idempotencyKey)
                headers['idempotency-key'] = init.idempotencyKey;
            const body = init.form ?? (init.body ? JSON.stringify(init.body(route)) : undefined);
            const res = await call(() => fetch(url, { body, headers, method, signal: AbortSignal.timeout(timeoutFor(url, method)) }));
            if (res.status !== 404) {
                speakerRoutes.set(this.#baseURL, route);
                return res;
            }
            last = res;
        }
        if (!last)
            throw new VocalStackAPIError(404, 'not_found', 'Not found.');
        return last;
    }
    async #speaker(method, paths, init) {
        const res = await this.#speakerRequest(method, paths, init);
        const body = (await res.json().catch(() => null));
        if (res.ok && body)
            return savedSpeakerOf(body);
        if (res.status === 502 || res.status === 503 || res.status === 504)
            throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        throw new VocalStackAPIError(res.status, body?.code ?? 'http_error', body?.message ?? `VocalStack answered ${res.status}`);
    }
    savedSpeaker(id) {
        // An empty id would read GET /v1/speakers/, the list, as if it were one speaker.
        if (!id)
            return Promise.reject(new VocalStackAPIError(404, 'not_found', 'No such speaker.'));
        return this.#speaker('GET', both(`/${encodeURIComponent(id)}`));
    }
    /** Save a speaker from a recorded sample (30 s or more), cloning their voice. Needs the speaker's permission. */
    createSpeaker(sample, fileName, meta, idempotencyKey) {
        const form = new FormData();
        form.append('meta', JSON.stringify(meta));
        form.append('sample', sample, fileName);
        return this.#speaker('POST', both(''), { form, idempotencyKey });
    }
    /**
     * Save a speaker from stretches of a transcribed recording (5–60 s in all), cloning their voice.
     * `draft` makes a trial to hear first; keep it with `keepSpeaker`, or delete it. Saved speakers
     * are the ones VocalStack looks for first when it works out who speaks in a new recording.
     */
    speakerFromAppearance(opts, idempotencyKey) {
        const { recordingId, speaker, transcriptionId, ...rest } = opts;
        const common = { ...rest, consent: true, library: true };
        return this.#speaker('POST', { speakers: transcriptionId ? '/v1/speakers/from-appearance' : undefined, voices: '/v1/voices/from-speaker' }, {
            // The spans are times in this recording: name it, or the server takes the latest one the speaker is heard in.
            body: (route) => (route === 'speakers' ? { ...common, appearance: speaker, recordingId, transcriptionId } : { ...common, recordingId, speaker }),
            idempotencyKey,
        });
    }
    /** Keep a trial speaker, as `name`, with the speaker's permission. */
    keepSpeaker(id, name) {
        return this.#speaker('PATCH', both(`/${encodeURIComponent(id)}`), { body: () => ({ consent: true, draft: false, library: true, name }) });
    }
    async deleteSpeaker(id) {
        const res = await this.#speakerRequest('DELETE', both(`/${encodeURIComponent(id)}`));
        if (res.ok)
            return;
        const body = (await res.json().catch(() => null));
        if (res.status === 502 || res.status === 503 || res.status === 504)
            throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        throw new VocalStackAPIError(res.status, body?.code ?? 'http_error', body?.message ?? `VocalStack answered ${res.status}`);
    }
    /** The saved speaker's cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
    speakerVoicePreview(id, lang, format = 'ogg') {
        return this.#speakerRequest('GET', both(`/${encodeURIComponent(id)}/preview`), { audio: true, query: { format, lang } });
    }
    availableVoices(lang, recordingId) {
        return call(() => this.sdk.voices.available(lang, { recording: recordingId }));
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
