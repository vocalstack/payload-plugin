/** Whether a new paragraph starts at this sentence: a new speaker, or a long pause. */
export const breaksParagraph = (s, prev) => !prev || s.speaker !== prev.speaker || s.start - prev.end > 2.5;
/** Sentences grouped into paragraphs. */
export function paragraphs(sentences) {
    const out = [];
    sentences.forEach((s, i) => {
        if (breaksParagraph(s, sentences[i - 1]))
            out.push([]);
        out[out.length - 1].push(s);
    });
    return out;
}
/** The plain text: sentences joined, a blank line between paragraphs. */
export function transcriptText(sentences) {
    return paragraphs(sentences)
        .map((p) => p.map((s) => s.text.trim()).join(' '))
        .join('\n\n');
}
/**
 * Give each sentence the words that fall inside it, as compact [start, end, text]
 * tuples. Words come from segments, which do not line up with sentences.
 */
export function attachWords(sentences, words) {
    const sorted = [...words].sort((a, b) => a.start - b.start);
    let i = 0;
    return sentences.map((s) => {
        const own = [];
        while (i < sorted.length && sorted[i].start < s.start - 0.05)
            i++;
        while (i < sorted.length && sorted[i].start < s.end + 0.05) {
            const w = sorted[i++];
            own.push([round(w.start), round(w.end), w.text.trim()]);
        }
        return own.length ? { ...s, words: own } : s;
    });
}
const round = (n) => Math.round(n * 100) / 100;
/**
 * The sentence's text as timed tokens. The text wins over the words (it carries
 * VocalStack's later corrections); the words give the timing. When the counts
 * differ, the times are spread evenly across the sentence.
 */
export function timedTokens(s) {
    const tokens = s.text.trim().split(/\s+/).filter(Boolean);
    const words = s.words ?? [];
    if (words.length === tokens.length)
        return tokens.map((t, i) => [words[i][0], words[i][1], t]);
    if (!tokens.length)
        return words;
    const span = (s.end - s.start) / tokens.length;
    return tokens.map((t, i) => [round(s.start + i * span), round(s.start + (i + 1) * span), t]);
}
/** The pause VocalStack leaves between two spoken sentences, at least. */
const SPOKEN_GAP_S = 0.15;
/**
 * Translated sentences in the timing of their spoken track. The track keeps each
 * sentence where it was said, unless the one before still runs: then it follows it
 * after a short pause. Each sentence's words come from the clip's word times, paired
 * with the translated text; when they do not pair up, they are spread evenly.
 */
export function spokenSentences(translated, clipDur, wordTimes = {}) {
    let cursor = 0;
    const out = [];
    for (const s of [...translated].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
        const dur = s.id === undefined ? undefined : clipDur[String(s.id)];
        if (!dur)
            continue;
        const at = Math.max(s.start, cursor);
        cursor = at + dur + SPOKEN_GAP_S;
        const tokens = s.text.trim().split(/\s+/).filter(Boolean);
        const times = wordTimes[String(s.id)] ?? [];
        const words = times.length === tokens.length
            ? tokens.map((t, i) => [round(at + times[i][0]), round(at + times[i][1]), t])
            : tokens.map((t, i) => [round(at + (i * dur) / tokens.length), round(at + ((i + 1) * dur) / tokens.length), t]);
        out.push({ ...s, end: round(at + dur), start: round(at), words });
    }
    return out;
}
