/**
 * A workspace's mark when it has no icon of its own, exactly as the VocalStack
 * Dashboard draws it: one or two letters, on a tile tinted with the workspace's colour.
 */

/** The first letter of the first two words, or the first two letters of a single word. */
export function workspaceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  const first = (w: string) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? ''
  if (words.length === 0) return '?'
  if (words.length === 1) return Array.from(words[0].replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase() || '?'
  return (first(words[0]) + first(words[1])).toUpperCase()
}

const HUES = [252, 200, 160, 128, 85, 40, 12, 330, 296]

/** The tile's hue in degrees (`oklch(.66 .13 <hue>)`), always the same for one workspace id. */
export function workspaceHue(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return HUES[(h >>> 0) % HUES.length]
}
