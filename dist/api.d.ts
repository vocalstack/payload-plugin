/**
 * The VocalStack API calls the plugin needs, made through the VocalStack JS SDK
 * (`@vocalstack/js-sdk`). This adapter keeps the plugin's own shapes and one error
 * type, so an engine that is down reads the same everywhere.
 * Contract: https://api.vocalstack.com/v1/openapi.json
 */
import { VocalStack } from '@vocalstack/js-sdk';
export declare const DEFAULT_API_URL = "https://api.vocalstack.com";
export declare const DEFAULT_DASHBOARD_URL = "https://app.vocalstack.com";
export type JobState = 'cropping' | 'done' | 'failed' | 'fetching' | 'queued' | 'stopped' | 'transcribing';
export type Job = {
    error?: null | string;
    /** Why a failed job failed; `stopped` when its owner stopped it. */
    errorCode?: null | string;
    progress: {
        pct: number;
        phase?: null | string;
        phasePct?: null | number;
        processedS?: number;
        totalS?: null | number;
    };
    recordingId: string;
    state: JobState;
    transcriptionId: string;
};
export type Transcription = {
    id: string;
    job?: Job | null;
    name: string;
};
export type Transcript = {
    lang?: null | string;
    segments: {
        end: number;
        seq: number;
        start: number;
        suppressed?: boolean;
        words?: {
            end: number;
            start: number;
            text: string;
        }[] | null;
    }[];
    sentences: {
        end: number;
        language?: null | string;
        sentenceId: number;
        speaker: number;
        start: number;
        suppressed?: boolean;
        text: string;
    }[];
};
export type SavedSpeaker = {
    cloneId: null | string;
    createdAt: string;
    draft?: boolean;
    error?: null | string;
    id: string;
    name: string;
    progress: number;
    sampleS: number;
    state: string;
};
export type VoiceOption = {
    cloned: boolean;
    default: boolean;
    gender?: null | string;
    id: string;
    name: string;
    quality: number;
    ready?: boolean;
};
/** A recording's spoken translation in one language, in one cast of voices. */
export type VoiceTrack = {
    /** Seconds each sentence's clip lasts, by sentence id. */
    clipDur?: Record<string, number>;
    clips: number[];
    durationS?: null | number;
    error?: null | string;
    lang: string;
    /** `queued`, `running`, `failed`, `sealed` (the track is ready), or `clips` (sentences only). */
    state: string;
    /** The voice it was asked in by name, if it was. */
    voice?: null | string;
    /** The track's key: `''` for the default voice on older tracks, else its cast (`cast:0=M1;1=F1`). */
    voiceKey: string;
    /** What it is read in: `cloned`, `synthetic`, or `mixed` (some speakers had no usable clone). Null on older tracks. */
    voices?: 'cloned' | 'mixed' | 'synthetic' | null;
    /** Each sentence's words as [start, end] within its clip, by sentence id. */
    wordTimes?: Record<string, [number, number][]>;
};
/** How a reading is voiced: in the speakers' cloned voices where VocalStack has them, or in stock voices. */
export type SpeakAs = {
    cloned: boolean;
};
export type Language = {
    code: string;
    name: string;
    native: string;
    translation: boolean;
    voice: boolean;
};
export type Languages = {
    languages: Language[];
    translation: string[];
    voice: string[];
};
export declare const UNAVAILABLE = "VocalStack is unavailable, try again shortly.";
export declare class VocalStackAPIError extends Error {
    code: string;
    status: number;
    constructor(status: number, code: string, message: string);
}
export declare class VocalStackAPI {
    #private;
    readonly sdk: VocalStack;
    constructor(apiKey: string, baseURL?: string);
    me(): Promise<Record<string, unknown>>;
    transcribeURL(url: string, opts: {
        idempotencyKey: string;
        name: string;
        spokenLanguage?: string;
    }): Promise<Transcription>;
    transcribeFile(file: Blob, fileName: string, opts: {
        idempotencyKey: string;
        name: string;
        spokenLanguage?: string;
    }): Promise<Transcription>;
    job(recordingId: string): Promise<Job>;
    /** Stop a job before it is done. Its job fails with `stopped`; what was transcribed so far stays in VocalStack. */
    stop(recordingId: string, reason?: string): Promise<unknown>;
    transcript(recordingId: string): Promise<Transcript>;
    /**
     * The translations VocalStack already holds for `lang`, by sentence id. `/translation`
     * answers only the sentences it translates in that call, so stored ones are read here.
     */
    storedTranslations(recordingId: string, lang: string): Promise<Record<string, string>>;
    languages(): Promise<Languages>;
    /** Sentences translated into `lang`, by sentence id. Untranslated ones are translated now, which takes a while. */
    translation(recordingId: string, lang: string, sentenceIds: number[]): Promise<{
        lang: string;
        translations: Record<string, string>;
    }>;
    /**
     * Read translations aloud, one job per language. `cloned` reads each speaker in their own cloned
     * voice where VocalStack can use one (a clone of that speaker, made with their permission, or the
     * clone of a saved speaker VocalStack recognised as them) and in a stock voice otherwise; `synthetic` reads
     * everyone in stock voices. Each track says which it got (`voices`: cloned, synthetic or mixed).
     * A clone only ever reads words its own speaker said.
     */
    speak(recordingId: string, langs: string[], as?: SpeakAs): Promise<VoiceTrack[]>;
    voiceTracks(recordingId: string, lang?: string): Promise<VoiceTrack[]>;
    /** An address of the recording's audio, or of a spoken translation's, that works for an hour or so. */
    audioURL(recordingId: string, opts: {
        format?: 'caf' | 'mp3' | 'ogg';
        kind: 'delivery' | 'voice';
        lang?: string;
        voice?: string;
    }): Promise<string>;
    /** A stretch of the recording as WAV (16 kHz mono), at most 120 s. */
    clip(recordingId: string, startS: number, endS: number): Promise<Response>;
    savedSpeaker(id: string): Promise<SavedSpeaker>;
    /** Save a speaker from a recorded sample (30 s or more), cloning their voice. Needs the speaker's permission. */
    createSpeaker(sample: Blob, fileName: string, meta: {
        consent: boolean;
        name: string;
    }, idempotencyKey: string): Promise<SavedSpeaker>;
    /**
     * Save a speaker from stretches of a transcribed recording (5–60 s in all), cloning their voice.
     * `draft` makes a trial to hear first; keep it with `keepSpeaker`, or delete it. Saved speakers
     * are the ones VocalStack looks for first when it works out who speaks in a new recording.
     */
    speakerFromAppearance(opts: {
        draft: boolean;
        name: string;
        recordingId: string;
        spans: {
            end: number;
            start: number;
        }[];
        speaker: number;
        transcriptionId?: string;
    }, idempotencyKey: string): Promise<SavedSpeaker>;
    /** Keep a trial speaker, as `name`, with the speaker's permission. */
    keepSpeaker(id: string, name: string): Promise<SavedSpeaker>;
    deleteSpeaker(id: string): Promise<void>;
    /** The saved speaker's cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
    speakerVoicePreview(id: string, lang?: string, format?: 'caf' | 'ogg'): Promise<Response>;
    availableVoices(lang: string, recordingId?: string): Promise<{
        lang: string;
        voices: VoiceOption[];
    }>;
}
/** A short label for the connected account, from whatever `/v1/me` carries. */
export declare function accountLabel(me: Record<string, unknown>): string | undefined;
