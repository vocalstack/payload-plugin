import type { TranscriptSentence, TranscriptWord } from './types.js';
/** Whether a new paragraph starts at this sentence: a new speaker, or a long pause. */
export declare const breaksParagraph: (s: TranscriptSentence, prev: TranscriptSentence | undefined) => boolean;
/** Sentences grouped into paragraphs. */
export declare function paragraphs(sentences: TranscriptSentence[]): TranscriptSentence[][];
/** The plain text: sentences joined, a blank line between paragraphs. */
export declare function transcriptText(sentences: TranscriptSentence[]): string;
/**
 * Give each sentence the words that fall inside it, as compact [start, end, text]
 * tuples. Words come from segments, which do not line up with sentences.
 */
export declare function attachWords<T extends TranscriptSentence>(sentences: T[], words: {
    end: number;
    start: number;
    text: string;
}[]): T[];
/**
 * The sentence's text as timed tokens. The text wins over the words (it carries
 * VocalStack's later corrections); the words give the timing. When the counts
 * differ, the times are spread evenly across the sentence.
 */
export declare function timedTokens(s: TranscriptSentence): TranscriptWord[];
/**
 * Translated sentences in the timing of their spoken track. The track keeps each
 * sentence where it was said, unless the one before still runs: then it follows it
 * after a short pause. Each sentence's words come from the clip's word times, paired
 * with the translated text; when they do not pair up, they are spread evenly.
 */
export declare function spokenSentences(translated: TranscriptSentence[], clipDur: Record<string, number>, wordTimes?: Record<string, [number, number][]>): TranscriptSentence[];
