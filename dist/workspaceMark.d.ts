/**
 * A workspace's mark when it has no icon of its own, exactly as the VocalStack
 * Dashboard draws it: one or two letters, on a tile tinted with the workspace's colour.
 */
/** The first letter of the first two words, or the first two letters of a single word. */
export declare function workspaceInitials(name: string): string;
/** The tile's hue in degrees (`oklch(.66 .13 <hue>)`), always the same for one workspace id. */
export declare function workspaceHue(id: string): number;
