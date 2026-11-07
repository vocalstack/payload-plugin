import { addDataAndFileToRequest } from 'payload';
import { randomUUID } from 'node:crypto';
import { DEFAULT_API_URL, VocalStackAPI, VocalStackAPIError } from '../api.js';
import { forListeners, languageList, listenerOptions } from '../languages.js';
import { resolveAPIKey } from '../settings.js';
import { apiError, canUpdate } from './transcribe.js';
const json = (body, status = 200, headers) => Response.json(body, { headers, status });
// VocalStack clones from 30 s to 120 s of speech (a clip is at most 120 s).
const MIN_SAMPLE_S = 30;
const MAX_SAMPLE_S = 120;
const STATES = new Set(['failed', 'ready', 'training']);
/** VocalStack's saved speaker as the document keeps it. */
const fieldData = (v) => ({
    cloneId: v.cloneId,
    createdAt: v.createdAt,
    error: v.error ?? null,
    progress: v.progress,
    sampleS: v.sampleS,
    speakerId: v.id,
    state: !v.cloneId ? 'none' : STATES.has(v.state) ? v.state : 'training',
});
/** A trial, as the panel follows it. */
const trialOf = (v) => ({ error: v.error ?? null, id: v.id, progress: v.progress, state: v.state });
/** Delete a trial; a kept speaker is never deleted this way. */
async function dropTrial(api, id) {
    if (!id)
        return;
    const speaker = await api.savedSpeaker(id).catch(() => null);
    if (speaker?.draft)
        await api.deleteSpeaker(id).catch(() => undefined);
}
// Picked from a recording, as in the VocalStack dashboard: at least 5 s makes a voice, at most 60 s.
export const PICK_MIN_S = 5;
export const PICK_MAX_S = 60;
const EMPTY = { cloneId: null, consentAt: null, createdAt: null, error: null, progress: null, sampleS: null, speakerId: null, state: 'none' };
/** The document's saved speaker: the `vocalstackSpeaker` group, else the `vocalstackVoice` group of 0.5 and earlier. */
export function speakerData(doc) {
    const now = doc.vocalstackSpeaker;
    if (now?.speakerId)
        return now;
    const old = doc.vocalstackVoice;
    if (old?.voiceId) {
        const { voiceId, ...rest } = old;
        return { ...EMPTY, ...rest, cloneId: voiceId, speakerId: voiceId };
    }
    return { ...EMPTY, ...now };
}
/** Copy every document's `vocalstackVoice` group (0.5) into `vocalstackSpeaker`, e.g. from a Payload migration. Answers how many moved. */
export async function migrateSpeakerFields({ collection, payload, req }) {
    let moved = 0;
    for (let page = 1;; page++) {
        const res = await payload.find({ collection, depth: 0, limit: 100, overrideAccess: true, page, req, where: { 'vocalstackVoice.voiceId': { exists: true } } });
        for (const doc of res.docs) {
            if (doc.vocalstackSpeaker?.speakerId)
                continue;
            const data = speakerData(doc);
            if (!data.speakerId)
                continue;
            await payload.update({ id: doc.id, collection, data: { vocalstackSpeaker: data }, depth: 0, overrideAccess: true, req });
            moved++;
        }
        if (!res.hasNextPage)
            return moved;
    }
}
export const legacyVoiceData = ({ cloneId, speakerId, ...rest }) => ({ ...rest, voiceId: cloneId ?? speakerId ?? null });
/**
 * A person saved as a VocalStack speaker, with their cloned voice, kept in the `vocalstackSpeaker` group of their document:
 *   GET    /:id/vocalstack/speaker            where its voice's training stands
 *   POST   /:id/vocalstack/speaker            save and clone them: JSON { recordingId, startS, endS, consent },
 *                                             or multipart with a `file` sample and `_payload` { consent }
 *   DELETE /:id/vocalstack/speaker            delete it, and its voice, in VocalStack too
 *   GET    /:id/vocalstack/speaker/sources    recordings to take the sample from
 *   GET    /:id/vocalstack/speaker/clip       a stretch of one of them, to hear before cloning (?recording=&startS=&endS=)
 *   GET    /:id/vocalstack/speaker/preview    the voice speaking (?lang=&format=ogg|caf)
 *   POST   /:id/vocalstack/speaker/trial      a trial from picked sentences { recordingId, speaker, spans, replace? }
 *   GET    /:id/vocalstack/speaker/trial      ?voice= where it stands; …/trial/preview?voice=&lang=&format= hear it
 *   POST   /:id/vocalstack/speaker/trial/keep { voice, name, consent } keep it as their speaker; DELETE …/trial?voice= drop it
 * Each also answers under /:id/vocalstack/voice…, its path in 0.5.
 * A sample is only ever taken from the recordings `config.recordings` offers for that document.
 */
export function speakerEndpoints(config, options) {
    const { collection } = config;
    const apiURL = options.apiURL ?? DEFAULT_API_URL;
    const open = async (req, verb) => {
        const id = req.routeParams?.id;
        if (!(await canUpdate(req, collection, id)))
            return json({ error: `You may not ${verb} this speaker.` }, 403);
        if (options.access && !(await options.access({ req })))
            return json({ error: `You may not ${verb} this speaker.` }, 403);
        const apiKey = await resolveAPIKey(req, options);
        if (!apiKey)
            return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409);
        const doc = (await req.payload.findByID({ id, collection, depth: 0, overrideAccess: true, req }).catch(() => null));
        if (!doc)
            return json({ error: 'Not found.' }, 404);
        return { api: new VocalStackAPI(apiKey, apiURL), doc, id };
    };
    /** The recording, when the host offers it for this person (`config.recordings`). */
    const ownRecording = async (req, doc, recordingId) => ((await config.recordings?.({ doc, req })) ?? []).find((s) => s.recordingId === recordingId);
    const save = async (req, id, data) => {
        await req.payload.update({ id, collection, data: { vocalstackSpeaker: data, vocalstackVoice: legacyVoiceData(data) }, depth: 0, overrideAccess: true, req });
        return data;
    };
    const answer = (name, data, status = 200) => json({ name, vocalstackSpeaker: data, vocalstackVoice: legacyVoiceData(data) }, status);
    const nameOf = (req, doc) => {
        const title = req.payload.collections[collection]?.config.admin?.useAsTitle;
        const name = config.name?.({ doc }) ?? (title && typeof doc[title] === 'string' ? doc[title] : typeof doc.name === 'string' ? doc.name : `${collection} ${doc.id}`);
        // VocalStack takes 1–60 characters.
        return name.trim().slice(0, 60) || `${collection} ${doc.id}`;
    };
    const endpoints = [
        {
            method: 'get',
            path: '/:id/vocalstack/speaker',
            handler: async (req) => {
                const found = await open(req, 'see');
                if (found instanceof Response)
                    return found;
                const { api, doc, id } = found;
                const stored = speakerData(doc);
                const migrated = !doc.vocalstackSpeaker?.speakerId && !!stored.speakerId;
                const current = migrated ? await save(req, id, stored) : stored;
                if (!current.speakerId || current.state === 'ready')
                    return answer(nameOf(req, doc), current);
                try {
                    const next = { ...current, ...fieldData(await api.savedSpeaker(current.speakerId)) };
                    const changed = next.state !== current.state || next.progress !== current.progress || next.error !== current.error || next.cloneId !== current.cloneId;
                    return answer(nameOf(req, doc), changed ? await save(req, id, next) : current);
                }
                catch (err) {
                    if (err instanceof VocalStackAPIError && err.status === 404)
                        return answer(nameOf(req, doc), await save(req, id, EMPTY));
                    return apiError(err);
                }
            },
        },
        {
            method: 'post',
            path: '/:id/vocalstack/speaker',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                const { api, doc, id } = found;
                let sample;
                let consent;
                const multipart = req.headers.get('content-type')?.includes('multipart/');
                try {
                    if (multipart) {
                        await addDataAndFileToRequest(req);
                        consent = req.data?.consent === true;
                        if (!req.file)
                            return json({ error: 'Add an audio sample.' }, 400);
                        sample = { blob: new Blob([new Uint8Array(req.file.data)], { type: req.file.mimetype }), name: req.file.name };
                    }
                    else {
                        const body = (await req.json?.().catch(() => ({})));
                        consent = body.consent === true;
                        const [startS, endS] = [Number(body.startS), Number(body.endS)];
                        if (typeof body.recordingId !== 'string' || !(endS - startS >= MIN_SAMPLE_S - 1.5 && endS - startS <= MAX_SAMPLE_S)) {
                            return json({ error: `Pick ${MIN_SAMPLE_S} to ${MAX_SAMPLE_S} seconds of a recording.` }, 400);
                        }
                        if (!consent)
                            return json({ error: 'Confirm you have their permission to clone their voice.' }, 400);
                        if (!(await ownRecording(req, doc, body.recordingId)))
                            return json({ error: 'That recording is not one of theirs.' }, 403);
                        const clip = await api.clip(body.recordingId, startS, endS);
                        sample = { blob: await clip.blob(), name: 'sample.wav' };
                    }
                    if (!consent)
                        return json({ error: 'Confirm you have their permission to clone their voice.' }, 400);
                    const previous = speakerData(doc).speakerId;
                    const speaker = await api.createSpeaker(sample.blob, sample.name, { consent: true, name: nameOf(req, doc) }, `payload:${collection}:${id}:voice:${randomUUID()}`);
                    const data = await save(req, id, { ...fieldData(speaker), consentAt: new Date().toISOString() });
                    // One saved speaker per person: the old one goes once the new one exists.
                    if (previous && previous !== speaker.id)
                        await api.deleteSpeaker(previous).catch(() => undefined);
                    return answer(nameOf(req, doc), data, 201);
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'delete',
            path: '/:id/vocalstack/speaker',
            handler: async (req) => {
                const found = await open(req, 'delete');
                if (found instanceof Response)
                    return found;
                const { api, doc, id } = found;
                const { speakerId } = speakerData(doc);
                try {
                    if (speakerId)
                        await api.deleteSpeaker(speakerId);
                }
                catch (err) {
                    if (!(err instanceof VocalStackAPIError && err.status === 404))
                        return apiError(err);
                }
                return answer(nameOf(req, doc), await save(req, id, EMPTY));
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speaker/sources',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                const sources = (await config.recordings?.({ doc: found.doc, req })) ?? [];
                return json({
                    sources: sources.map(({ label, recordingId, sentences }) => ({
                        label,
                        recordingId,
                        sentences: (sentences ?? []).filter((s) => !s.draft).map(({ end, id, speaker, start, text }) => ({ end, id, speaker, start, text })),
                    })),
                });
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speaker/clip',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                const recording = req.searchParams.get('recording');
                const [startS, endS] = [Number(req.searchParams.get('startS')), Number(req.searchParams.get('endS'))];
                if (!recording || !(endS > startS) || endS - startS > MAX_SAMPLE_S)
                    return json({ error: `At most ${MAX_SAMPLE_S} seconds.` }, 400);
                if (!(await ownRecording(req, found.doc, recording)))
                    return json({ error: 'That recording is not one of theirs.' }, 403);
                try {
                    const res = await found.api.clip(recording, startS, endS);
                    return new Response(res.body, { headers: { 'cache-control': 'private, max-age=3600', 'content-type': 'audio/wav' } });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            // A trial voice from sentences of one of their recordings, to hear before keeping it.
            method: 'post',
            path: '/:id/vocalstack/speaker/trial',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                const { api, doc, id } = found;
                const body = (await req.json?.().catch(() => ({})));
                const spans = (Array.isArray(body.spans) ? body.spans : [])
                    .map((s) => ({ end: Number(s?.end), start: Number(s?.start) }))
                    .filter((s) => Number.isFinite(s.start) && s.end > s.start);
                const total = spans.reduce((t, s) => t + (s.end - s.start), 0);
                if (typeof body.recordingId !== 'string' || !Number.isInteger(body.speaker) || total < PICK_MIN_S - 0.05 || total > PICK_MAX_S + 0.5) {
                    return json({ error: `Pick ${PICK_MIN_S} to ${PICK_MAX_S} seconds of their speech.` }, 400);
                }
                const source = await ownRecording(req, doc, body.recordingId);
                if (!source)
                    return json({ error: 'That recording is not one of theirs.' }, 403);
                try {
                    const transcriptionId = source.transcriptionId ?? (await api.job(source.recordingId).then((j) => j.transcriptionId, () => undefined));
                    const trial = await api.speakerFromAppearance({ draft: true, name: nameOf(req, doc), recordingId: source.recordingId, spans, speaker: body.speaker, transcriptionId }, `payload:${collection}:${id}:trial:${randomUUID()}`);
                    // The trial it replaces (other samples picked) is not wanted any more.
                    if (typeof body.replace === 'string' && body.replace !== trial.id)
                        await dropTrial(api, body.replace);
                    return json({ voice: trialOf(trial) }, 201);
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speaker/trial',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                try {
                    const trial = await found.api.savedSpeaker(req.searchParams.get('voice') ?? '');
                    if (!trial.draft)
                        return json({ error: 'Not a trial voice.' }, 404);
                    return json({ voice: trialOf(trial) });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speaker/trial/preview',
            handler: async (req) => {
                const found = await open(req, 'hear');
                if (found instanceof Response)
                    return found;
                const format = req.searchParams.get('format') === 'caf' ? 'caf' : 'ogg';
                try {
                    const trial = await found.api.savedSpeaker(req.searchParams.get('voice') ?? '');
                    if (!trial.draft)
                        return json({ error: 'Not a trial voice.' }, 404);
                    const res = await found.api.speakerVoicePreview(trial.id, req.searchParams.get('lang') ?? undefined, format);
                    if (res.status === 202)
                        return json({ pending: true }, 202);
                    if (!res.ok)
                        return json({ error: `VocalStack answered ${res.status}` }, res.status >= 500 ? 502 : res.status);
                    return new Response(res.body, { headers: { 'cache-control': 'private, max-age=600', 'content-type': res.headers.get('content-type') ?? 'audio/ogg' } });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            // Keep the trial as their saved speaker (with their permission); the one they had before goes.
            method: 'post',
            path: '/:id/vocalstack/speaker/trial/keep',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                const { api, doc, id } = found;
                const body = (await req.json?.().catch(() => ({})));
                if (body.consent !== true)
                    return json({ error: 'Confirm you have their permission to clone their voice.' }, 400);
                if (typeof body.voice !== 'string')
                    return json({ error: 'Which voice?' }, 400);
                const name = (typeof body.name === 'string' && body.name.trim() ? body.name.trim() : nameOf(req, doc)).slice(0, 60);
                try {
                    const trial = await api.savedSpeaker(body.voice);
                    if (!trial.draft)
                        return json({ error: 'Not a trial voice.' }, 404);
                    const speaker = await api.keepSpeaker(trial.id, name);
                    const previous = speakerData(doc).speakerId;
                    const data = await save(req, id, { ...fieldData(speaker), consentAt: new Date().toISOString() });
                    if (previous && previous !== speaker.id)
                        await api.deleteSpeaker(previous).catch(() => undefined);
                    return answer(nameOf(req, doc), data);
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
        {
            method: 'delete',
            path: '/:id/vocalstack/speaker/trial',
            handler: async (req) => {
                const found = await open(req, 'create');
                if (found instanceof Response)
                    return found;
                await dropTrial(found.api, req.searchParams.get('voice') ?? '');
                return json({ ok: true });
            },
        },
        {
            method: 'get',
            path: '/:id/vocalstack/speaker/preview',
            handler: async (req) => {
                const found = await open(req, 'hear');
                if (found instanceof Response)
                    return found;
                const { cloneId, speakerId } = speakerData(found.doc);
                if (!speakerId || !cloneId)
                    return json({ error: 'There is no voice yet.' }, 404);
                const format = req.searchParams.get('format') === 'caf' ? 'caf' : 'ogg';
                try {
                    const res = await found.api.speakerVoicePreview(speakerId, req.searchParams.get('lang') ?? undefined, format);
                    // 202: being rendered; the client asks again.
                    if (res.status === 202)
                        return json({ pending: true }, 202);
                    if (!res.ok)
                        return json({ error: `VocalStack answered ${res.status}` }, res.status >= 500 ? 502 : res.status);
                    return new Response(res.body, { headers: { 'cache-control': 'private, max-age=3600', 'content-type': res.headers.get('content-type') ?? 'audio/ogg' } });
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
    ];
    return [...endpoints, ...endpoints.map((e) => ({ ...e, path: e.path.replace('/vocalstack/speaker', '/vocalstack/voice') }))];
}
/**
 * Shared lookups:
 *   GET /vocalstack/languages                      what can be translated and spoken (public with `listeners` on)
 *   GET /vocalstack/voices?lang=&recording=        voices that can speak a language (signed in, and `options.access`)
 */
export function lookupEndpoints(options) {
    const apiURL = options.apiURL ?? DEFAULT_API_URL;
    const listeners = listenerOptions(options);
    const allowed = async (req) => {
        if (!req.user)
            return json({ error: 'Sign in first.' }, 401);
        if (options.access && !(await options.access({ req })))
            return json({ error: 'You may not use VocalStack here.' }, 403);
    };
    const api = async (req) => {
        const refused = await allowed(req);
        if (refused)
            return refused;
        const apiKey = await resolveAPIKey(req, options);
        if (!apiKey)
            return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409);
        return new VocalStackAPI(apiKey, apiURL);
    };
    return [
        {
            method: 'get',
            path: '/vocalstack/languages',
            handler: async (req) => {
                // Listeners pick from the languages the site offers them; editors see all of VocalStack's.
                if (!req.user && listeners) {
                    return json(forListeners(await languageList(req, options), listeners), 200, { 'cache-control': 'public, max-age=3600, s-maxage=3600' });
                }
                const refused = await allowed(req);
                if (refused)
                    return refused;
                if (!(await resolveAPIKey(req, options)))
                    return json({ code: 'not_connected', error: 'Connect VocalStack first.' }, 409);
                return json(await languageList(req, options));
            },
        },
        {
            method: 'get',
            path: '/vocalstack/voices',
            handler: async (req) => {
                const client = await api(req);
                if (client instanceof Response)
                    return client;
                const lang = req.searchParams.get('lang');
                if (!lang)
                    return json({ error: 'Which language?' }, 400);
                try {
                    return json(await client.availableVoices(lang, req.searchParams.get('recording') ?? undefined));
                }
                catch (err) {
                    return apiError(err);
                }
            },
        },
    ];
}
