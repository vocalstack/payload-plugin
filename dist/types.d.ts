import type { CollectionConfig, CollectionSlug, PayloadRequest, TypeWithID } from 'payload';
export type VocalStackPluginOptions = {
    /**
     * Where finished spoken readings are kept: the plugin downloads each one's MP3
     * once and saves it as an upload here, so listeners are served from your
     * storage and VocalStack is not asked again. Default: an upload collection
     * `vocalstack-readings` the plugin adds (point your storage adapter at it).
     * `false` streams readings from VocalStack instead.
     *
     * `overrides` adjusts the added collection (access, labels, admin, upload
     * options). A host may instead define its own upload collection with that slug;
     * the plugin then uses it as it is. It needs to accept `audio/mpeg` and have text
     * fields `lang`, `recordingId` and `voice`.
     */
    readings?: false | {
        overrides?: (collection: CollectionConfig) => CollectionConfig;
        slug?: CollectionSlug;
    };
    /** Turn the plugin off without removing it (fields stay in the schema). */
    enabled?: boolean;
    /**
     * A VocalStack API key (`vs_key_…`, Read + Write). When set it wins over a key
     * connected from the admin panel; leave it out to connect from the admin instead.
     */
    apiKey?: string;
    /**
     * Upload collections that get the Transcribe button. Defaults to every upload
     * collection that accepts audio (or has no MIME type restriction). The button
     * only appears on documents whose `mimeType` is `audio/*`.
     */
    collections?: CollectionSlug[];
    /**
     * Audio that is not an upload document: rows of an array field that each point
     * at a file by address (a filename, an imported link). Every row gets its own
     * Transcribe button and transcript.
     */
    audioFields?: AudioFieldConfig[];
    /** Default https://api.vocalstack.com */
    apiURL?: string;
    /** Default https://app.vocalstack.com */
    dashboardURL?: string;
    /**
     * Show "Connect VocalStack" (opens the dashboard in a new tab; one click on
     * Authenticate there). Needs the dashboard's /connect flow; until then, paste a key.
     */
    oneClickConnect?: boolean;
    /** A Whisper language code (`en`, `ro`, …). Leave out to auto-detect. */
    spokenLanguage?: string;
    /**
     * The public URL VocalStack fetches the audio from. Defaults to the document's
     * `url`, made absolute against `serverURL` or the request's origin. When that
     * address is not public (localhost, a private network), the plugin uploads the
     * file's bytes instead.
     */
    fileURL?: (args: {
        collection: CollectionSlug;
        doc: UploadDoc;
        req: PayloadRequest;
    }) => Promise<string | undefined> | string | undefined;
    /** Who may start a transcription. Default: any signed-in user who can update the document. */
    access?: (args: {
        req: PayloadRequest;
    }) => boolean | Promise<boolean>;
    /**
     * Collections of people (speakers, presenters) that each get a cloned VocalStack voice:
     * made from a stretch of a recording they speak in, or from a sample, with their permission.
     */
    voices?: VoiceCollectionConfig[];
    /**
     * The VocalStack voice (`clone:<id>`, `F1`, …) a transcript's translations are spoken in
     * by default, e.g. the cloned voice of the person speaking. Nothing: VocalStack's default.
     */
    speechVoice?: (args: {
        collection: CollectionSlug;
        doc: Record<string, unknown>;
        req: PayloadRequest;
        row?: ArrayRow;
    }) => Promise<string | undefined> | string | undefined;
};
export type VoiceCollectionConfig = {
    collection: CollectionSlug;
    /** The voice's name in VocalStack. Default: the collection's `useAsTitle` field, else `name`. */
    name?: (args: {
        doc: Record<string, unknown>;
    }) => string;
    /** Transcribed recordings this person speaks in, offered as the sample to clone from. */
    recordings?: (args: {
        doc: Record<string, unknown>;
        req: PayloadRequest;
    }) => Promise<VoiceSource[]> | VoiceSource[];
};
/** A transcribed recording to take a voice sample from. */
export type VoiceSource = {
    label: string;
    recordingId: string;
    sentences?: TranscriptSentence[];
};
export type VoiceState = 'failed' | 'none' | 'ready' | 'training';
/** The `vocalstackVoice` group on a voice collection's documents. */
export type VoiceFieldData = {
    consentAt?: null | string;
    createdAt?: null | string;
    error?: null | string;
    progress?: null | number;
    sampleS?: null | number;
    state?: null | VoiceState;
    voiceId?: null | string;
};
export type Translation = {
    /** The transcript's sentences (same ids and times), their text translated. */
    sentences: TranscriptSentence[];
    translatedAt: string;
};
export type SpeechState = 'failed' | 'queued' | 'running' | 'sealed';
export type Speech = {
    durationS?: null | number;
    error?: null | string;
    renderedAt?: null | string;
    requestedAt: string;
    /** Once sealed: the translated sentences in the spoken track's timing, with their words. */
    sentences?: null | TranscriptSentence[];
    state: SpeechState;
    /** The voice it is spoken in; `null` for VocalStack's default. */
    voice: null | string;
    /** Once sealed: the reading's MP3, saved once in the readings upload collection and served from there. */
    audio?: null | {
        filename?: null | string;
        id: number | string;
        url: string;
    };
};
export type ArrayRow = Record<string, unknown> & {
    id?: null | string;
    vocalstack?: null | VocalStackFieldData;
};
export type AudioFieldConfig = {
    collection: CollectionSlug;
    /** An array field at the top level of the collection (or inside tabs, rows or collapsibles). */
    field: string;
    /** The row's audio address, or nothing when the row has no audio. Relative addresses resolve against the server URL. */
    audioURL: (args: {
        doc: Record<string, unknown>;
        req: PayloadRequest;
        row: ArrayRow;
    }) => Promise<string | undefined> | string | undefined;
    /** Show the button and transcript only on rows this accepts (admin condition). Default: every row. */
    condition?: (row: ArrayRow) => boolean;
    /** The transcription's name in VocalStack. Default: the document's title, else collection and id. */
    name?: (args: {
        doc: Record<string, unknown>;
        row: ArrayRow;
    }) => string;
};
export type UploadDoc = TypeWithID & {
    filename?: null | string;
    mimeType?: null | string;
    url?: null | string;
    vocalstack?: null | VocalStackFieldData;
};
export type TranscriptStatus = 'done' | 'failed' | 'idle' | 'processing';
export type VocalStackFieldData = {
    error?: null | string;
    language?: null | string;
    recordingId?: null | string;
    sentences?: null | TranscriptSentence[];
    status?: null | TranscriptStatus;
    transcript?: null | string;
    transcriptionId?: null | string;
    transcribedAt?: null | string;
    /** By language code. */
    translations?: null | Record<string, Translation>;
    /** Spoken translations, by language code. */
    speech?: null | Record<string, Speech>;
};
/** [start, end, text], seconds. */
export type TranscriptWord = [number, number, string];
export type TranscriptSentence = {
    /** Live only: words heard after the last settled sentence. */
    draft?: boolean;
    end: number;
    /** VocalStack's sentenceId. */
    id?: number;
    speaker: number;
    start: number;
    text: string;
    words?: TranscriptWord[];
};
/** What the status endpoint answers, and what the Transcribe button renders. */
export type StatusResponse = {
    /** Seconds of audio transcribed so far, and in all (while transcribing). */
    audio?: {
        processedS: number;
        totalS?: number;
    };
    error?: string;
    /** The sentences so far, while the job runs (the polling fallback). */
    partial?: TranscriptSentence[];
    phase?: string;
    progress?: number;
    status: TranscriptStatus;
    /** The job was stopped before it finished; the field is back to how it was before. */
    stopped?: boolean;
    vocalstack?: VocalStackFieldData;
};
export type ConnectionResponse = {
    account?: string;
    connected: boolean;
    /** `options`: the key is in the plugin config; `admin`: connected from the admin panel. */
    source?: 'admin' | 'options';
};
/** What the translate and speak endpoints answer. */
export type SpeechResponse = {
    /** The voice readings use unless one is picked (`speechVoice`); `null`: VocalStack's default. */
    defaultVoice?: null | string;
    /** The translate endpoint ran out of time; call it again to carry on. */
    more?: boolean;
    vocalstack: VocalStackFieldData;
};
