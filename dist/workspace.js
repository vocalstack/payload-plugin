/**
 * The `workspace` of `GET /v1/me` or of the `POST /v1/connect/token` answer, with its
 * icon's address made absolute (the API sends it relative to its own address).
 * `undefined` when there is none: an older API leaves it out.
 */
export function workspaceOf(raw, apiURL) {
    if (!raw || typeof raw !== 'object')
        return undefined;
    const { iconUrl, id, name, personal } = raw;
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim())
        return undefined;
    let icon = null;
    if (typeof iconUrl === 'string' && iconUrl) {
        try {
            const url = new URL(iconUrl, `${apiURL.replace(/\/+$/, '')}/`);
            if (url.protocol === 'https:' || url.protocol === 'http:')
                icon = url.toString();
        }
        catch { }
    }
    return { iconUrl: icon, id, name: name.trim(), personal: personal === true };
}
