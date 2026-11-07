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
     * Collections of people (speakers, presenters) that are each saved as a VocalStack speaker,
     * with a cloned voice made from a stretch of a recording they speak in, or from a sample,
     * with their permission.
     */
    speakers?: SpeakerCollectionConfig[];
    /** @deprecated Renamed to `speakers`; still read when `speakers` is not set. */
    voices?: SpeakerCollectionConfig[];
    /**
     * Let the site's visitors ask for a transcript in their own language: it is translated,
     * read aloud where VocalStack has a voice for it, and kept on the document (and the
     * readings collection) like an editor's. Off by default. `true` allows every language
     * VocalStack translates; see {@link ListenerOptions}.
     */
    listeners?: boolean | ListenerOptions;
    /**
     * Whether a transcript is read in its speakers' cloned voices or in synthetic ones, decided by
     * the site (e.g. from the person speaking: `cloned` once they have a voice). `cloned` reads each
     * speaker in their clone where VocalStack has one for them, and in a stock voice otherwise.
     * Answer nothing to leave it to the transcript's own toggle. When set, the toggle is not shown.
     */
    voiceMode?: (args: {
        collection: CollectionSlug;
        doc: Record<string, unknown>;
        req: PayloadRequest;
        row?: ArrayRow;
    }) => Promise<undefined | VoiceMode> | undefined | VoiceMode;
};
export type ListenerOptions = {
    /** Languages visitors may ask for. Default: every language VocalStack translates. */
    languages?: string[];
    /** Read new languages aloud too, where VocalStack has a voice for them. Default `true`. */
    speak?: boolean;
    /** Who may ask for a new language. Default: anyone who may read the document. */
    access?: (args: {
        lang: string;
        req: PayloadRequest;
    }) => boolean | Promise<boolean>;
    /** New languages one visitor (by IP address) may ask for in an hour, on this server. Default 10. */
    perHour?: number;
};
export type SpeakerCollectionConfig = {
    collection: CollectionSlug;
    /** The speaker's name in VocalStack. Default: the collection's `useAsTitle` field, else `name`. */
    name?: (args: {
        doc: Record<string, unknown>;
    }) => string;
    /** Transcribed recordings this person speaks in, offered as the sample to clone from. */
    recordings?: (args: {
        doc: Record<string, unknown>;
        req: PayloadRequest;
    }) => Promise<SpeakerSource[]> | SpeakerSource[];
};
/** A transcribed recording to take a voice sample from. */
export type SpeakerSource = {
    label: string;
    recordingId: string;
    sentences?: TranscriptSentence[];
    transcriptionId?: string;
};
export type CloneState = 'failed' | 'none' | 'ready' | 'training';
/** The `vocalstackSpeaker` group on a speaker collection's documents. */
export type SpeakerFieldData = {
    cloneId?: null | string;
    consentAt?: null | string;
    createdAt?: null | string;
    error?: null | string;
    progress?: null | number;
    sampleS?: null | number;
    speakerId?: null | string;
    state?: null | CloneState;
};
/** @deprecated The `vocalstackVoice` group of 0.5 and earlier, kept in step for a release; read `vocalstackSpeaker`. */
export type VoiceFieldData = {
    consentAt?: null | string;
    createdAt?: null | string;
    error?: null | string;
    progress?: null | number;
    sampleS?: null | number;
    state?: null | CloneState;
    voiceId?: null | string;
};
export type SpeakerAnswer = {
    name?: string;
    vocalstackSpeaker: SpeakerFieldData;
    vocalstackVoice?: VoiceFieldData;
};
/** @deprecated Renamed to `SpeakerCollectionConfig`. */
export type VoiceCollectionConfig = SpeakerCollectionConfig;
/** @deprecated Renamed to `SpeakerSource`. */
export type VoiceSource = SpeakerSource;
/** @deprecated Renamed to `CloneState`. */
export type VoiceState = CloneState;
export type Translation = {
    /** The transcript's sentences (same ids and times), their text translated. */
    sentences: TranscriptSentence[];
    translatedAt: null | string;
    /**
     * Asked for and not finished: the server carries on translating (when the document is
     * read, or its progress asked for) until every sentence is done, with no one watching.
     */
    pending?: boolean;
    /** Why translating stopped, when it failed for good. */
    error?: null | string;
    requestedAt?: null | string;
};
/** `translating`: asked for, waiting for its translation to finish before VocalStack reads it. */
export type SpeechState = 'failed' | 'queued' | 'running' | 'sealed' | 'translating';
export type Speech = {
    /** While it is made: how many sentences have been voiced so far. */
    done?: null | number;
    durationS?: null | number;
    error?: null | string;
    renderedAt?: null | string;
    requestedAt: string;
    /** Once sealed: the translated sentences in the spoken track's timing, with their words. */
    sentences?: null | TranscriptSentence[];
    state: SpeechState;
    /** Read in speakers' cloned voices, or in stock (synthetic) ones. */
    cast?: null | VoiceMode;
    /** What VocalStack read it in: `cloned`, `synthetic`, or `mixed` (some speakers had no usable clone). */
    readIn?: 'cloned' | 'mixed' | 'synthetic' | null;
    /** VocalStack's key for the voices it is read in (e.g. `cast:-1=M1`); `null` until VocalStack says. */
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
    /** The voices readings of this transcript are made in. Default `synthetic`. */
    voices?: null | VoiceMode;
};
/** `cloned`: each speaker's own cloned voice, where they have one; `synthetic`: VocalStack's stock voices. */
export type VoiceMode = 'cloned' | 'synthetic';
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
/** Where one language of a transcript stands, for a listener: what the listen endpoint answers. */
export type ListenStatus = {
    lang: string;
    /** `ready`: it can be read (and heard, when `speech` is `ready`). `none`: never asked for. */
    state: 'failed' | 'none' | 'ready' | 'translating';
    /** Sentences translated so far, and in all. */
    done: number;
    total: number;
    error?: null | string;
    /** Whether VocalStack reads this language aloud. */
    voice: boolean;
    speech?: {
        /** Sentences read so far (while `reading`). */
        done?: null | number;
        /** The reading's MP3, kept in the site's own storage, once ready. */
        audio?: null | string;
        error?: null | string;
        state: 'failed' | 'reading' | 'ready' | 'waiting';
    } | null;
    /** Changes whenever the translation or the reading does: a cache key for the text and audio. */
    version: string;
};
/** What the translate and speak endpoints answer. */
export type SpeechResponse = {
    /** The voices readings are made in now, and whether the site decides it (`voiceMode`) rather than the toggle. */
    voiceMode?: {
        fixed: boolean;
        mode: VoiceMode;
    };
    /** The translate endpoint ran out of time; call it again to carry on. */
    more?: boolean;
    vocalstack: VocalStackFieldData;
};
