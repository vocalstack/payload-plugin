import { DEFAULT_API_URL, UNAVAILABLE, VocalStackAPI, VocalStackAPIError } from '../api.js';
import { readingsSlug } from '../readings.js';
import { resolveAPIKey } from '../settings.js';
import { spokenSentences } from '../text.js';
import { apiError, canUpdate, locate } from './transcribe.js';
const json = (body, status = 200) => Response.json(body, { status });
// Translating is slow (a sermon takes minutes): batches run side by side, and a call
// stops starting new ones after a while so it answers before the host's time limit.
// The client calls again to carry on; what is done is saved each time.
const BATCH = 30;
const PARALLEL = 4;
const BUDGET_MS = 150_000;
const LANG = /^[a-z]{2,3}(-[a-z0-9]+)?$/i;
/** The transcript's sentences that can be translated: settled, numbered, with text. */
const translatable = (data) => (Array.isArray(data.sentences) ? data.sentences : []).filter((s) => !s.draft && s.id !== undefined && s.text.trim());
/** Translate what is still missing in `lang`, within the time budget, and save it. Whether some is left, and the field as saved. */
async function translate(api, target, lang, deadline) {
    const sentences = translatable(target.data);
    const have = new Map((target.data.translations?.[lang]?.sentences ?? []).map((s) => [s.id, s.text]));
    const missing = sentences.filter((s) => !have.get(s.id)).map((s) => s.id);
    const batches = [];
    const got = new Map();
    let failure;
    // What VocalStack translated before (for anyone) costs nothing to read back; only the rest is translated.
    if (missing.length) {
        try {
            const stored = await api.storedTranslations(target.data.recordingId, lang);
            for (const id of missing)
                if (stored[String(id)]?.trim())
                    got.set(id, stored[String(id)].trim());
        }
        catch {
            // Not readable just now: translate them all instead.
        }
        const left = missing.filter((id) => !got.has(id));
        for (let i = 0; i < left.length; i += BATCH)
            batches.push(left.slice(i, i + BATCH));
    }
    const worker = async () => {
        for (let batch = batches.shift(); batch; batch = batches.shift()) {
            if (Date.now() > deadline || failure)
                return;
            try {
                const { translations } = await api.translation(target.data.recordingId, lang, batch);
                for (const [id, text] of Object.entries(translations))
                    if (text?.trim())
                        got.set(Number(id), text.trim());
            }
            catch (err) {
                failure ??= err;
            }
        }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    let data = target.data;
    if (got.size) {
        data = await target.save((current) => {
            const before = new Map((current.translations?.[lang]?.sentences ?? []).map((s) => [s.id, s.text]));
            const translation = {
                sentences: translatable(current).flatMap(({ end, id, speaker, start }) => {
                    const text = got.get(id) ?? before.get(id);
                    return text ? [{ end, id, speaker, start, text }] : [];
                }),
                translatedAt: new Date().toISOString(),
            };
            return { translations: { ...current.translations, [lang]: translation } };
        });
    }
    // Nothing came back at all: say why, rather than "call again" forever. VocalStack
    // answers an empty set when its translator is down, so for a language with no
    // translation yet that is unavailable too.
    if (failure && !got.size)
        throw failure;
    const ranOut = Date.now() > deadline;
    if (missing.length && !got.size && !have.size && !ranOut)
        throw new VocalStackAPIError(503, 'unavailable', UNAVAILABLE);
    // A few sentences VocalStack will not translate (it answers nothing for them) must
    // not keep the language "still translating": only running out of time leaves more.
    return { data, more: ranOut && got.size < missing.length };
}
/** A file name from the recording's name: `sermon-ro.mp3`. */
const readingName = (target, lang, voice) => `${(target.name || target.fileName.replace(/\.[^.]+$/, '')).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'reading'}-${lang}${voice ? '-' + voice.replace(/[^\w-]+/g, '-') : ''}.mp3`;
/**
 * Download a finished reading's MP3 from VocalStack, once, and keep it as an upload in
 * the readings collection, so listeners are served from the site's storage from then on.
 */
async function keepReading(req, api, slug, target, lang, speech) {
    if (speech.audio || speech.state !== 'sealed')
        return speech;
    const src = await api.audioURL(target.data.recordingId, { kind: 'voice', lang, voice: speech.voice ?? undefined });
    const res = await fetch(src);
    if (!res.ok)
        throw new VocalStackAPIError(502, 'unavailable', UNAVAILABLE);
    const data = Buffer.from(await res.arrayBuffer());
    const doc = (await req.payload.create({
        collection: slug,
        data: { lang, recordingId: target.data.recordingId, voice: speech.voice ?? '' },
        file: { data, mimetype: 'audio/mpeg', name: readingName(target, lang, speech.voice), size: data.length },
        overrideAccess: true,
        req,
    }));
    return { ...speech, audio: { filename: doc.filename ?? null, id: doc.id, url: doc.url ?? '' } };
}
/** Readings being downloaded right now, so overlapping status checks fetch each one once. */
const keeping = new Set();
/** Remove a reading's kept file (it is being replaced, or its language dropped). */
async function dropReading(req, slug, speech) {
    if (!slug || !speech?.audio)
        return;
    await req.payload.delete({ collection: slug, id: speech.audio.id, overrideAccess: true, req }).catch(() => { });
}
/** The track VocalStack made for this language in this voice. */
const trackFor = (tracks, lang, speech) => tracks.find((t) => t.lang === lang && t.voiceKey === (speech.voice ?? ''));
/** A spoken translation brought up to date from VocalStack's track. */
function settle(speech, track, translation) {
    if (!track) {
        // Asked for but not listed (yet): a job is created with the request, so give it a little while.
        const age = Date.now() - new Date(speech.requestedAt).getTime();
        return age < 120_000 ? speech : { ...speech, error: 'VocalStack has no reading of this language. Try again.', state: 'failed' };
    }
    if (track.state === 'failed')
        return { ...speech, error: track.error ?? 'The reading failed.', state: 'failed' };
    if (track.state !== 'sealed')
        return { ...speech, error: null, state: track.state === 'queued' ? 'queued' : 'running' };
    return {
        ...speech,
        durationS: track.durationS ?? null,
        error: null,
        renderedAt: new Date().toISOString(),
        sentences: spokenSentences(translation?.sentences ?? [], track.clipDur ?? {}, track.wordTimes ?? {}),
        state: 'sealed',
    };
}
/**
 * Translations of a transcript, and spoken readings of them, on the same document or
 * row as the transcript (`?field=&row=` as for transcribing):
 *   POST   /:id/vocalstack/translate  { langs }          translate (call again while `more`)
 *   DELETE /:id/vocalstack/translate?lang=               drop a language, spoken reading too
 *   POST   /:id/vocalstack/speak      { langs, voice? }  read translations aloud
 *   GET    /:id/vocalstack/speak                         where the readings stand
 *   GET    /:id/vocalstack/audio?lang=                   public: the audio, or its reading in `lang`
 */
export function speechEndpoints(collection, options, rowFields) {
    const apiURL = options.apiURL ?? DEFAULT_API_URL;
    const readings = readingsSlug(options);
    /** An editor's target with a finished transcript, and the API to work on it. */
    const editable = async (req, verb) => {
        const id = req.routeParams?.id;
        if (!(await canUpdate(req, collection, id)))
            return json({ error: `You may not ${verb} this transcript.` }, 403);
        if (options.access && !(await options.access({ req })))
            return json({ error: `You may not ${verb} this transcript.` }, 403);
        const apiKey = await resolveAPIKey(req, options);
        if (!apiKey)
            return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409);
        const target = await locate(req, collection, options, rowFields, 'admin');
        if (target instanceof Response)
            return target;
        if (target.data.status !== 'done' || !target.data.recordingId)
            return json({ error: 'Transcribe the audio first.' }, 409);
        return { api: new VocalStackAPI(apiKey, apiURL), target };
    };
    /** The body's languages (none of them the spoken one) and voice. */
    const bodyOf = async (req, spoken) => {
        const body = (await req.json?.().catch(() => ({})));
        const langs = Array.isArray(body.langs) ? [...new Set(body.langs.map(String).map((l) => l.toLowerCase()))] : [];
        if (!langs.length || langs.some((l) => !LANG.test(l) || l === spoken))
            return undefined;
        return { langs, voice: typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : undefined };
    };
    const defaultVoice = async (req, target) => (await options.speechVoice?.({ collection, doc: target.doc, req, row: target.row })) ?? null;
    return [
        {
            method: 'post',
            path: '/:id/vocalstack/translate',
            handler: async (req) => {
                const found = await editable(req, 'translate');
                if (found instanceof Response)
                    return found;
                const { api, target } = found;
                const asked = await bodyOf(req, target.data.language);
                if (!asked)
                    return json({ error: 'Name the languages to translate into.' }, 400);
                const deadline = Date.now() + BUDGET_MS;
                try {
                    let more = false;
                    let data = target.data;
                    for (const lang of asked.langs) {
                        if (Date.now() > deadline) {
                            more = true;
                            continue;
                        }
                        const done = await translate(api, { ...target, data }, lang, deadline);
                        data = done.data;
                        more ||= done.more;
                    }
                    return json({ more, vocalstack: data });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'delete',
            path: '/:id/vocalstack/translate',
            handler: async (req) => {
                const found = await editable(req, 'change');
                if (found instanceof Response)
                    return found;
                const lang = req.searchParams.get('lang') ?? '';
                await dropReading(req, readings, found.target.data.speech?.[lang]);
                const vocalstack = await found.target.save((current) => {
                    const { [lang]: _t, ...translations } = current.translations ?? {};
                    const { [lang]: _s, ...speech } = current.speech ?? {};
                    return { speech, translations };
                });
                return json({ vocalstack });
            },
        },
        {
            method: 'post',
            path: '/:id/vocalstack/speak',
            handler: async (req) => {
                const found = await editable(req, 'read out');
                if (found instanceof Response)
                    return found;
                const { api, target } = found;
                const asked = await bodyOf(req, target.data.language);
                if (!asked)
                    return json({ error: 'Name the languages to read out.' }, 400);
                const { langs } = asked;
                const voice = asked.voice ?? (await defaultVoice(req, target)) ?? undefined;
                try {
                    // A reading speaks the translation, so every language needs one first.
                    const deadline = Date.now() + BUDGET_MS;
                    let data = target.data;
                    for (const lang of langs) {
                        if (data.translations?.[lang]?.sentences.length)
                            continue;
                        const done = await translate(api, { ...target, data }, lang, deadline);
                        data = done.data;
                        if (done.more)
                            return json({ code: 'translating', error: 'Still translating; try again in a moment.' }, 409);
                    }
                    await api.speak(target.data.recordingId, langs, voice);
                    for (const lang of langs)
                        await dropReading(req, readings, data.speech?.[lang]);
                    const requestedAt = new Date().toISOString();
                    const vocalstack = await target.save((current) => ({
                        speech: { ...current.speech, ...Object.fromEntries(langs.map((l) => [l, { error: null, requestedAt, state: 'queued', voice: voice ?? null }])) },
                    }));
                    return json({ defaultVoice: await defaultVoice(req, target), vocalstack }, 202);
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speak',
            handler: async (req) => {
                if (!req.user)
                    return json({ error: 'Sign in first.' }, 401);
                const target = await locate(req, collection, options, rowFields, 'user');
                if (target instanceof Response)
                    return target;
                const all = Object.entries(target.data.speech ?? {});
                const pending = all.filter(([, s]) => s.state === 'queued' || s.state === 'running');
                // Finished readings whose file is not kept yet (made before readings were kept, or a download that failed).
                const unkept = readings ? all.filter(([, s]) => s.state === 'sealed' && !s.audio) : [];
                const answer = async (vocalstack) => json({ defaultVoice: await defaultVoice(req, target), vocalstack });
                if ((!pending.length && !unkept.length) || !target.data.recordingId)
                    return answer(target.data);
                const apiKey = await resolveAPIKey(req, options);
                if (!apiKey)
                    return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409);
                try {
                    const api = new VocalStackAPI(apiKey, apiURL);
                    const next = {};
                    if (pending.length) {
                        const tracks = await api.voiceTracks(target.data.recordingId);
                        for (const [lang, speech] of pending) {
                            const settled = settle(speech, trackFor(tracks, lang, speech), target.data.translations?.[lang]);
                            if (settled.state !== speech.state || settled.error !== speech.error)
                                next[lang] = settled;
                        }
                    }
                    // Each finished reading is downloaded once and kept; after that VocalStack is not asked for it again.
                    if (readings) {
                        for (const [lang, speech] of [...unkept, ...Object.entries(next)]) {
                            const key = `${collection}:${req.routeParams?.id}:${req.searchParams.get('row') ?? ''}:${lang}`;
                            if (keeping.has(key))
                                continue;
                            keeping.add(key);
                            try {
                                const done = await keepReading(req, api, readings, target, lang, next[lang] ?? speech);
                                next[lang] = done;
                            }
                            catch {
                                // Not now: it is still playable from VocalStack, and the next look tries again.
                            }
                            finally {
                                keeping.delete(key);
                            }
                        }
                    }
                    if (!Object.keys(next).length)
                        return answer(target.data);
                    const losers = [];
                    const saved = await target.save((current) => {
                        const merged = { ...current.speech };
                        for (const [lang, s] of Object.entries(next)) {
                            // Kept by an overlapping request meanwhile (another server): theirs stays, ours goes.
                            const theirs = current.speech?.[lang]?.audio;
                            if (theirs && s.audio && theirs.id !== s.audio.id) {
                                losers.push(s);
                                merged[lang] = { ...s, audio: theirs };
                            }
                            else
                                merged[lang] = s;
                        }
                        return { speech: merged };
                    });
                    for (const loser of losers)
                        await dropReading(req, readings, loser);
                    return answer(saved);
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/audio',
            handler: async (req) => {
                // Public: whoever may read the document may listen, signed in or not.
                const target = await locate(req, collection, options, rowFields, 'user');
                if (target instanceof Response)
                    return target;
                const { language, recordingId, speech } = target.data;
                if (!recordingId)
                    return json({ error: 'No audio.' }, 404);
                const lang = req.searchParams.get('lang')?.toLowerCase();
                const spoken = !lang || lang === language;
                const reading = spoken ? undefined : speech?.[lang];
                if (!spoken && reading?.state !== 'sealed')
                    return json({ error: 'There is no reading in that language.' }, 404);
                // Kept files are served from the site's own storage: no VocalStack request.
                const own = spoken ? await target.url().catch(() => undefined) : reading?.audio?.url;
                if (own) {
                    return new Response(null, { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400', location: new URL(own, req.url ?? 'http://localhost').toString() }, status: 302 });
                }
                const apiKey = await resolveAPIKey(req, options);
                if (!apiKey)
                    return json({ error: 'Not available.' }, 404);
                try {
                    const url = await new VocalStackAPI(apiKey, apiURL).audioURL(recordingId, spoken ? { kind: 'delivery' } : { kind: 'voice', lang, voice: reading?.voice ?? undefined });
                    // The signed address lasts an hour; hand out the same one for a few minutes.
                    return new Response(null, { headers: { 'cache-control': 'public, max-age=300, s-maxage=300', location: url }, status: 302 });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
    ];
}
