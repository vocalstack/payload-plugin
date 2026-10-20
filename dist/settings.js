export const SETTINGS_SLUG = 'vocalstack';
const hidden = { admin: { hidden: true }, access: { read: () => false, update: () => false } };
/**
 * Where a key connected from the admin lives. Nothing here is readable or
 * writable over the REST/GraphQL APIs: only the plugin's endpoints touch it
 * (with `overrideAccess`), so the key never reaches a browser.
 */
export const settingsGlobal = (options) => ({
    slug: SETTINGS_SLUG,
    label: 'VocalStack',
    admin: {
        group: 'Settings',
    },
    access: {
        read: ({ req }) => Boolean(req.user),
        update: () => false,
    },
    fields: [
        {
            name: 'connection',
            type: 'ui',
            admin: {
                components: {
                    Field: { clientProps: { oneClickConnect: Boolean(options.oneClickConnect) }, path: '@vocalstack/payload/client#ConnectionPanel' },
                },
            },
        },
        { name: 'apiKey', type: 'text', ...hidden },
        { name: 'account', type: 'text', ...hidden },
        // A pending one-click connect: PKCE verifier and state, for ten minutes.
        { name: 'connectState', type: 'text', ...hidden },
        { name: 'connectVerifier', type: 'text', ...hidden },
        { name: 'connectExpiresAt', type: 'date', ...hidden },
    ],
});
export async function readSettings(req) {
    return (await req.payload.findGlobal({ slug: SETTINGS_SLUG, overrideAccess: true, req }));
}
export async function writeSettings(req, data) {
    await req.payload.updateGlobal({ slug: SETTINGS_SLUG, data, overrideAccess: true, req });
}
/** The key to call VocalStack with: the plugin option first, then a connected one. */
export async function resolveAPIKey(req, options) {
    if (options.apiKey)
        return options.apiKey;
    return (await readSettings(req)).apiKey ?? undefined;
}
