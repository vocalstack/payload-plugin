/**
 * The handful of VocalStack API calls the plugin needs, on plain fetch (the
 * SDK is not on npm yet). Contract: https://api.vocalstack.com/v1/openapi.json
 */
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
export class VocalStackAPI {
    apiKey;
    baseURL;
    constructor(apiKey, baseURL = DEFAULT_API_URL) {
        this.apiKey = apiKey;
        this.baseURL = baseURL;
    }
    /**
     * The raw answer. An engine that is down or does not answer in time (an upgrade, an
     * outage) is one error, `unavailable`, so the admin says so instead of hanging.
     */
    async fetch(method, path, opts = {}) {
        const init = {
            headers: { accept: 'application/json', authorization: `Bearer ${this.apiKey}`, ...opts.headers },
            method,
            redirect: opts.redirect,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        };
        if (opts.body instanceof FormData)
            init.body = opts.body;
        else if (opts.body !== undefined) {
            init.body = JSON.stringify(opts.body);
            init.headers['content-type'] = 'application/json';
        }
        let res;
        try {
            res = await fetch(`${this.baseURL}${path}`, init);
        }
        catch {
            throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        }
        if (res.status === 502 || res.status === 504 || (res.status === 503 && !res.headers.get('content-type')?.includes('json'))) {
            throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
        }
        return res;
    }
    async request(method, path, body, headers = {}, timeoutMs) {
        const res = await this.fetch(method, path, { body, headers, timeoutMs });
        const data = await res.json().catch(() => undefined);
        if (!res.ok) {
            const err = (data?.error ?? data);
            throw new VocalStackAPIError(res.status, err?.code ?? 'http_error', err?.message ?? `VocalStack answered ${res.status}`);
        }
        return data;
    }
    me() {
        return this.request('GET', '/v1/me');
    }
    transcribeURL(url, opts) {
        return this.request('POST', '/v1/transcriptions', { name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined, url }, { 'idempotency-key': opts.idempotencyKey });
    }
    transcribeFile(file, fileName, opts) {
        const form = new FormData();
        form.append('options', JSON.stringify({ name: opts.name, settings: opts.spokenLanguage ? { spokenLanguage: opts.spokenLanguage } : undefined }));
        form.append('file', file, fileName);
        return this.request('POST', '/v1/transcriptions', form, { 'idempotency-key': opts.idempotencyKey });
    }
    job(recordingId) {
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/job`);
    }
    /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
    stop(recordingId, reason) {
        return this.request('POST', `/v1/recordings/${encodeURIComponent(recordingId)}/stop`, { reason: reason ?? null });
    }
    transcript(recordingId) {
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/transcript`);
    }
    /**
     * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
     * answers only the sentences it translates in that call, so stored ones are read here.
     */
    async storedTranslations(recordingId, lang) {
        const t = await this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/transcript?lang=${encodeURIComponent(lang)}`);
        const out = {};
        for (const s of t.sentences ?? []) {
            const text = s.translations?.[lang];
            if (text?.trim())
                out[String(s.sentenceId)] = text;
        }
        return out;
    }
    languages() {
        return this.request('GET', '/v1/languages');
    }
    /** Sentences translated into `lang`, by sentence id. Untranslated ones are translated now, which takes a while. */
    translation(recordingId, lang, sentenceIds) {
        const q = new URLSearchParams({ lang, sentences: sentenceIds.join(',') });
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/translation?${q}`, undefined, {}, 180_000);
    }
    /** Render spoken translations, one job per language, in `voice` (the default voice when left out). */
    speak(recordingId, langs, voice) {
        return this.request('POST', `/v1/recordings/${encodeURIComponent(recordingId)}/voice`, voice ? { langs, voice } : { langs });
    }
    voiceTracks(recordingId, lang) {
        return this.request('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/voice${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`);
    }
    /** A freshly signed address (an hour) of the recording's audio, or of a spoken translation's. */
    async audioURL(recordingId, opts) {
        const q = new URLSearchParams({ format: opts.format ?? 'mp3', kind: opts.kind });
        if (opts.lang)
            q.set('lang', opts.lang);
        if (opts.voice)
            q.set('voice', opts.voice);
        const res = await this.fetch('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/audio?${q}`, { redirect: 'manual' });
        const location = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && location)
            return new URL(location, this.baseURL).toString();
        const data = (await res.json().catch(() => undefined));
        throw new VocalStackAPIError(res.ok ? 502 : res.status, data?.code ?? 'http_error', data?.message ?? `VocalStack answered ${res.status}`);
    }
    /** A stretch of the recording as WAV (16 kHz mono), at most 120 s. */
    async clip(recordingId, startS, endS) {
        const res = await this.fetch('GET', `/v1/recordings/${encodeURIComponent(recordingId)}/audio/clip?startS=${startS}&endS=${endS}`, { timeoutMs: 60_000 });
        if (!res.ok)
            await this.raise(res);
        return res;
    }
    voice(id) {
        return this.request('GET', `/v1/voices/${encodeURIComponent(id)}`);
    }
    /** Clone a voice from a recorded sample (30 s or more). Needs the speaker's permission. */
    createVoice(sample, fileName, meta, idempotencyKey) {
        const form = new FormData();
        form.append('meta', JSON.stringify(meta));
        form.append('sample', sample, fileName);
        return this.request('POST', '/v1/voices', form, { 'idempotency-key': idempotencyKey }, 120_000);
    }
    deleteVoice(id) {
        return this.request('DELETE', `/v1/voices/${encodeURIComponent(id)}`);
    }
    availableVoices(lang, recordingId) {
        const q = new URLSearchParams({ lang });
        if (recordingId)
            q.set('recording', recordingId);
        return this.request('GET', `/v1/voices/available?${q}`);
    }
    /** The cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
    voicePreview(id, lang, format = 'ogg') {
        const q = new URLSearchParams({ format });
        if (lang)
            q.set('lang', lang);
        return this.fetch('GET', `/v1/voices/${encodeURIComponent(id)}/preview?${q}`, { timeoutMs: 60_000 });
    }
    async raise(res) {
        const data = (await res.json().catch(() => undefined));
        const err = data?.error ?? data;
        throw new VocalStackAPIError(res.status, err?.code ?? 'http_error', err?.message ?? `VocalStack answered ${res.status}`);
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
