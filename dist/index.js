import { connectionEndpoints } from './endpoints/connection.js';
import { streamEndpoint } from './endpoints/stream.js';
import { transcribeEndpoints } from './endpoints/transcribe.js';
import { settingsGlobal } from './settings.js';
export { timedTokens, transcriptText } from './text.js';
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
    return {
        ...config,
        collections: collections.map((collection) => {
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
                endpoints: enabled ? [...(collection.endpoints || []), ...transcribeEndpoints(collection.slug, options, rowFields), streamEndpoint(collection.slug, options, rowFields)] : collection.endpoints,
                fields,
            };
        }),
        endpoints: enabled ? [...(config.endpoints ?? []), ...connectionEndpoints(options)] : config.endpoints,
        globals: [...(config.globals ?? []), settingsGlobal(options)],
    };
};
