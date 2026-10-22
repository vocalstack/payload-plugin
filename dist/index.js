import { connectionEndpoints } from './endpoints/connection.js';
import { speechEndpoints } from './endpoints/speech.js';
import { streamEndpoint } from './endpoints/stream.js';
import { transcribeEndpoints } from './endpoints/transcribe.js';
import { lookupEndpoints, voiceEndpoints } from './endpoints/voices.js';
import { settingsGlobal } from './settings.js';
export { spokenSentences, timedTokens, transcriptText } from './text.js';
/** The voice to read translations in (`clone:<id>`), once a person's cloned voice is ready. */
export const clonedVoiceKey = (data) => data?.state === 'ready' && data.voiceId ? `clone:${data.voiceId}` : undefined;
const isAudioDoc = (data) => typeof data?.mimeType === 'string' && data.mimeType.startsWith('audio/');
/** An upload collection that can hold audio: `audio/*`, a wildcard, or no restriction at all. */
function acceptsAudio(collection) {
    if (!collection.upload)
        return false;
    const mimeTypes = collection.upload === true ? undefined : collection.upload.mimeTypes;
    return !mimeTypes?.length || mimeTypes.some((m) => m.startsWith('audio') || m === '*' || m === '*/*');
}
const hidden = { admin: { hidden: true, readOnly: true } };
/** The Transcribe button and the `vocalstack` group, for an upload document or for each row of an array. */
function transcriptionFields(enabled, options, target) {
    return [
        ...(enabled
            ? [
                {
                    name: 'vocalstackTranscribe',
                    type: 'ui',
                    admin: {
                        components: {
                            Field: {
                                clientProps: { field: target.field, oneClickConnect: Boolean(options.oneClickConnect) },
                                path: '@vocalstack/payload/client#TranscribeButton',
                            },
                        },
                        condition: target.condition,
                        ...(target.sidebar ? { position: 'sidebar' } : {}),
                    },
                },
            ]
            : []),
        {
            name: 'vocalstack',
            type: 'group',
            label: 'Transcript',
            admin: { condition: target.condition },
            fields: [
                {
                    name: 'transcript',
                    type: 'textarea',
                    label: false,
                    admin: { components: { Field: '@vocalstack/payload/client#TranscriptField' } },
                },
                {
                    name: 'status',
                    type: 'select',
                    defaultValue: 'idle',
                    options: ['idle', 'processing', 'done', 'failed'],
                    ...hidden,
                },
                { name: 'error', type: 'text', ...hidden },
                { name: 'language', type: 'text', ...hidden },
                { name: 'recordingId', type: 'text', ...hidden },
                { name: 'transcriptionId', type: 'text', ...hidden },
                { name: 'transcribedAt', type: 'date', ...hidden },
                // [{ start, end, speaker, text }] in seconds, for captions or a synced player.
                { name: 'sentences', type: 'json', ...hidden },
                // { [lang]: { translatedAt, sentences } }: the sentences above, translated.
                { name: 'translations', type: 'json', ...hidden },
                // { [lang]: { voice, state, …, sentences } }: translations read aloud, in the reading's timing.
                { name: 'speech', type: 'json', ...hidden },
                ...(enabled
                    ? [
                        {
                            name: 'vocalstackSpeech',
                            type: 'ui',
                            admin: {
                                components: { Field: { clientProps: { field: target.field }, path: '@vocalstack/payload/client#SpeechField' } },
                                condition: (_, siblingData) => siblingData?.status === 'done',
                            },
                        },
                    ]
                    : []),
            ],
        },
    ];
}
/** A person's cloned voice: the panel, and what VocalStack says about the voice. */
function voiceFields(enabled) {
    return [
        ...(enabled
            ? [
                {
                    name: 'vocalstackVoicePanel',
                    type: 'ui',
                    admin: { components: { Field: '@vocalstack/payload/client#VoiceField' }, position: 'sidebar' },
                },
            ]
            : []),
        {
            name: 'vocalstackVoice',
            type: 'group',
            label: 'Voice',
            admin: { hidden: true },
            fields: [
                { name: 'voiceId', type: 'text', ...hidden },
                { name: 'state', type: 'select', defaultValue: 'none', options: ['none', 'training', 'ready', 'failed'], ...hidden },
                { name: 'progress', type: 'number', ...hidden },
                { name: 'error', type: 'text', ...hidden },
                { name: 'sampleS', type: 'number', ...hidden },
                { name: 'consentAt', type: 'date', ...hidden },
                { name: 'createdAt', type: 'date', ...hidden },
            ],
        },
    ];
}
/** Add fields to the named array, looking through unnamed containers (rows, collapsibles, unnamed tabs). */
function addToArray(fields, name, extra) {
    let found = false;
    const visit = (list) => list.map((f) => {
        if (found)
            return f;
        if (f.type === 'array' && f.name === name) {
            found = true;
            return { ...f, fields: [...f.fields, ...extra] };
        }
        if ((f.type === 'row' || f.type === 'collapsible') && !('name' in f && f.name))
            return { ...f, fields: visit(f.fields) };
        if (f.type === 'tabs')
            return { ...f, tabs: f.tabs.map((t) => ('name' in t && t.name ? t : { ...t, fields: visit(t.fields) })) };
        return f;
    });
    return { fields: visit(fields), found };
}
export const vocalstackPlugin = (options = {}) => (config) => {
    const enabled = options.enabled !== false;
    const collections = config.collections ?? [];
    const uploads = new Set(options.collections ?? collections.filter(acceptsAudio).map((c) => c.slug));
    const audioFields = options.audioFields ?? [];
    const voices = options.voices ?? [];
    for (const v of voices) {
        if (!collections.some((c) => c.slug === v.collection))
            throw new Error(`vocalstackPlugin: no collection "${v.collection}" for voices`);
    }
    return {
        ...config,
        collections: collections.map((original) => {
            const voice = voices.find((v) => v.collection === original.slug);
            const collection = voice
                ? {
                    ...original,
                    endpoints: enabled ? [...(original.endpoints || []), ...voiceEndpoints(voice, options)] : original.endpoints,
                    fields: [...original.fields, ...voiceFields(enabled)],
                }
                : original;
            const rowFields = audioFields.filter((f) => f.collection === collection.slug);
            const isUpload = uploads.has(collection.slug);
            if (!isUpload && !rowFields.length)
                return collection;
            let fields = isUpload ? [...collection.fields, ...transcriptionFields(enabled, options, { condition: isAudioDoc, sidebar: true })] : collection.fields;
            for (const row of rowFields) {
                const condition = (_, siblingData) => (row.condition ? row.condition(siblingData) : true);
                const result = addToArray(fields, row.field, transcriptionFields(enabled, options, { condition, field: row.field, sidebar: false }));
                if (!result.found)
                    throw new Error(`vocalstackPlugin: no array field "${row.field}" in collection "${collection.slug}"`);
                fields = result.fields;
            }
            return {
                ...collection,
                endpoints: enabled
                    ? [
                        ...(collection.endpoints || []),
                        ...transcribeEndpoints(collection.slug, options, rowFields),
                        streamEndpoint(collection.slug, options, rowFields),
                        ...speechEndpoints(collection.slug, options, rowFields),
                    ]
                    : collection.endpoints,
                fields,
            };
        }),
        endpoints: enabled ? [...(config.endpoints ?? []), ...connectionEndpoints(options), ...lookupEndpoints(options)] : config.endpoints,
        globals: [...(config.globals ?? []), settingsGlobal(options)],
    };
};
