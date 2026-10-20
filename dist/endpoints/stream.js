import { DEFAULT_API_URL, VocalStackAPI } from '../api.js';
import { resolveAPIKey } from '../settings.js';
import { attachWords } from '../text.js';
import { apiError, checkJob, locate, toSentences } from './transcribe.js';
const OVER = new Set(['done', 'failed', 'cropping', 'ended', 'finalized']);
/**
 * GET /:id/vocalstack/stream: the job live, as Server-Sent Events. The server holds
 * the VocalStack subscribe socket (the API key never reaches the browser) and sends
 *   progress  { progress, phase, audio }        as it changes
 *   snapshot  { sentences }                      everything so far, once caught up
 *   sentence  { sentence } | { id, removed }     a settled sentence, new or rewritten
 *   draft     { words }                          words heard after the last settled sentence
 *   done | failed | stopped  (StatusResponse)    once, saved on the document; then it closes
 * Sentences carry their words as [start, end, text]. A dropped stream is resumed by
 * EventSource: it reconnects and gets a fresh snapshot.
 */
export function streamEndpoint(collection, options, rowFields) {
    const apiURL = options.apiURL ?? DEFAULT_API_URL;
    return {
        method: 'get',
        path: '/:id/vocalstack/stream',
        handler: async (req) => {
            if (!req.user)
                return Response.json({ error: 'Sign in first.' }, { status: 401 });
            const target = await locate(req, collection, options, rowFields, 'user');
            if (target instanceof Response)
                return target;
            const recordingId = target.data.recordingId;
            if (target.data.status !== 'processing' || !recordingId)
                return Response.json({ status: target.data.status ?? 'idle', vocalstack: target.data });
            const apiKey = await resolveAPIKey(req, options);
            if (!apiKey)
                return Response.json({ code: 'not_connected', error: 'Connect VocalStack first.' }, { status: 409 });
            const api = new VocalStackAPI(apiKey, apiURL);
            const encoder = new TextEncoder();
            let socket;
            let heartbeat;
            let draftTimer;
            let closed = false;
            const stream = new ReadableStream({
                cancel() {
                    closed = true;
                    cleanup();
                },
                start(controller) {
                    const send = (event, data) => {
                        if (!closed)
                            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
                    };
                    const finish = (result) => {
                        if (closed)
                            return;
                        send(result.stopped ? 'stopped' : result.status === 'processing' ? 'progress' : result.status, result);
                        closed = true;
                        cleanup();
                        controller.close();
                    };
                    // VocalStack signals the end several ways (progress, state, socket close); check once at a time.
                    let settling;
                    const settle = () => (settling ??= checkJob(api, target, recordingId)
                        .then((r) => (r.status === 'processing' ? undefined : finish(r)), (err) => finish({ error: err.message, status: 'failed' }))
                        .finally(() => (settling = undefined)));
                    // What the page has been told: settled sentences by id, the words of committed
                    // segments (sentences take theirs by time), and the words heard since.
                    const sentences = new Map();
                    const segmentWords = new Map();
                    let draft = [];
                    let caughtUp = false;
                    let lastProgress = '';
                    const withWords = (s, seqs) => {
                        const pool = seqs?.length ? seqs.flatMap((q) => segmentWords.get(q) ?? []) : [...segmentWords.values()].flat();
                        return attachWords([s], pool)[0];
                    };
                    const sendDraft = () => {
                        draftTimer = undefined;
                        const settledTo = Math.max(0, ...[...sentences.values()].map((s) => s.end));
                        draft = draft.filter((w) => w.end > settledTo);
                        send('draft', { words: draft.map((w) => [w.start, w.end, w.text.trim()]) });
                    };
                    const scheduleDraft = () => {
                        if (caughtUp)
                            draftTimer ??= setTimeout(sendDraft, 200);
                    };
                    controller.enqueue(encoder.encode('retry: 2000\n\n'));
                    heartbeat = setInterval(() => !closed && controller.enqueue(encoder.encode(': ping\n\n')), 15000);
                    const wsURL = `${apiURL.replace(/^http/, 'ws')}/v1/recordings/${encodeURIComponent(recordingId)}/subscribe`;
                    // Node's WebSocket (undici) takes headers, which the DOM type does not know about.
                    socket = new WebSocket(wsURL, { headers: { authorization: `Bearer ${apiKey}` } });
                    socket.onmessage = (message) => {
                        let frame;
                        try {
                            frame = JSON.parse(String(message.data));
                        }
                        catch {
                            return;
                        }
                        switch (frame.type) {
                            case 'job.progress': {
                                if (frame.state && OVER.has(frame.state))
                                    return void settle();
                                const progress = frame.state === 'fetching' ? (frame.phasePct ?? 0) : (frame.pct ?? 0);
                                const audio = frame.processedS !== undefined ? { processedS: frame.processedS, totalS: frame.totalS ?? undefined } : undefined;
                                const update = { audio, phase: frame.state === 'fetching' ? (frame.phase ?? 'fetching') : frame.state, progress, status: 'processing' };
                                // VocalStack repeats progress frames; pass on only what changed.
                                const key = JSON.stringify(update);
                                if (key === lastProgress)
                                    return;
                                lastProgress = key;
                                return send('progress', update);
                            }
                            case 'recording.state':
                            case 'subscribe.ready':
                                if (frame.state && OVER.has(frame.state))
                                    return void settle();
                                if (frame.type === 'subscribe.ready') {
                                    // Catch up on everything said before the socket opened. Live frames that
                                    // arrive meanwhile update the same maps by id, so the overlap is harmless.
                                    void api.transcript(recordingId).then((t) => {
                                        for (const g of t.segments ?? [])
                                            if (!g.suppressed && g.words)
                                                segmentWords.set(g.seq, g.words);
                                        for (const s of toSentences(t))
                                            if (s.id !== undefined && !sentences.has(s.id))
                                                sentences.set(s.id, s);
                                        caughtUp = true;
                                        send('snapshot', { sentences: [...sentences.values()].sort((a, b) => a.start - b.start) });
                                        scheduleDraft();
                                    }, () => undefined);
                                }
                                return;
                            case 'transcript.committed':
                                if (frame.segment && !frame.segment.suppressed && frame.segment.words)
                                    segmentWords.set(frame.segment.seq, frame.segment.words);
                                return;
                            case 'transcript.sentence': {
                                const s = frame.sentence;
                                if (!s)
                                    return;
                                if (s.suppressed || !s.text.trim()) {
                                    sentences.delete(s.sentenceId);
                                    if (caughtUp)
                                        send('sentence', { id: s.sentenceId, removed: true });
                                }
                                else {
                                    const sentence = withWords({ id: s.sentenceId, end: s.end, speaker: s.speaker, start: s.start, text: s.text.trim() }, s.seqs);
                                    sentences.set(s.sentenceId, sentence);
                                    if (caughtUp)
                                        send('sentence', { sentence });
                                }
                                return scheduleDraft();
                            }
                            case 'transcript.words':
                                draft.push(...(frame.words ?? []));
                                return scheduleDraft();
                        }
                    };
                    // The socket ended without the job ending: say where it stands, then let EventSource reconnect.
                    socket.onclose = () => {
                        if (!closed)
                            void settle().then(() => !closed && (closed = true, cleanup(), controller.close()));
                    };
                },
            });
            function cleanup() {
                clearInterval(heartbeat);
                clearTimeout(draftTimer);
                if (socket && socket.readyState <= 1)
                    socket.close();
            }
            try {
                return new Response(stream, {
                    headers: { 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' },
                });
            }
            catch (err) {
                return apiError(err);
            }
        },
    };
}
