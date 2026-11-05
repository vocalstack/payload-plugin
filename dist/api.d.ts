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
export type Voice = {
    createdAt: string;
    /** A trial voice, to hear before it is kept. */
    draft?: boolean;
    error?: null | string;
    id: string;
    name: string;
    progress: number;
    sampleS: number;
    /** `training`, `ready` or `failed`. */
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
/** A recording's spoken translation in one language and voice (`voiceKey` is `''` for the default voice). */
export type VoiceTrack = {
    /** Seconds each sentence's clip lasts, by sentence id. */
    clipDur?: Record<string, number>;
    clips: number[];
    durationS?: null | number;
    error?: null | string;
    lang: string;
    /** `queued`, `running`, `failed`, `sealed` (the track is ready), or `clips` (sentences only). */
    state: string;
    /** `synthetic` or `cloned` (the API's voice modes); older APIs answer a voice name here, or nothing. */
    voice?: null | string;
    voiceKey: string;
    /** Each sentence's words as [start, end] within its clip, by sentence id. */
    wordTimes?: Record<string, [number, number][]>;
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
     * Render spoken translations, one job per language, in the recording's default cast: VocalStack
     * picks each speaker's voice. `cloned` lets it use speakers' own cloned voices (each made with
     * that speaker's permission); otherwise it reads in stock voices.
     */
    speak(recordingId: string, langs: string[], opts?: {
        cloned?: boolean;
    }): Promise<VoiceTrack[]>;
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
    voice(id: string): Promise<Voice>;
    /** Clone a voice from a recorded sample (30 s or more). Needs the speaker's permission. */
    createVoice(sample: Blob, fileName: string, meta: {
        consent: boolean;
        name: string;
    }, idempotencyKey: string): Promise<Voice>;
    /**
     * Clone a speaker's voice from stretches of a transcribed recording (5–60 s in all). `draft`
     * makes a trial voice to hear first; keep it with `keepVoice`, or delete it.
     */
    voiceFromSpeaker(opts: {
        draft: boolean;
        name: string;
        recordingId: string;
        spans: {
            end: number;
            start: number;
        }[];
        speaker: number;
    }, idempotencyKey: string): Promise<Voice>;
    /** Keep a trial voice, as `name`, with the speaker's permission. */
    keepVoice(id: string, name: string): Promise<Voice>;
    deleteVoice(id: string): Promise<unknown>;
    availableVoices(lang: string, recordingId?: string): Promise<{
        lang: string;
        voices: VoiceOption[];
    }>;
    /** The cloned voice speaking a few seconds of `lang`, Ogg/Opus or CAF. 202 while it is being made. */
    voicePreview(id: string, lang?: string, format?: 'caf' | 'ogg'): Promise<Response>;
}
/** A short label for the connected account, from whatever `/v1/me` carries. */
export declare function accountLabel(me: Record<string, unknown>): string | undefined;
