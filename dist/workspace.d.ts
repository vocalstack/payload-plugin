/**
 * The VocalStack workspace an API key belongs to. Everything the key makes lands
 * there and is billed there, and a key never changes workspace: working in another
 * one takes a new key, from connecting again.
 */
export type Workspace = {
    /** The workspace's own icon (a PNG that needs no key to load), or `null` when it has none. */
    iconUrl: null | string;
    id: string;
    /** As the VocalStack Dashboard shows it (`Personal workspace` for an unnamed personal one). */
    name: string;
    /** The workspace every person starts with. */
    personal: boolean;
};
/**
 * The `workspace` of `GET /v1/me` or of the `POST /v1/connect/token` answer, with its
 * icon's address made absolute (the API sends it relative to its own address).
 * `undefined` when there is none: an older API leaves it out.
 */
export declare function workspaceOf(raw: unknown, apiURL: string): undefined | Workspace;
