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
