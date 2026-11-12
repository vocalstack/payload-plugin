'use client';
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, TextInput, toast } from '@payloadcms/ui';
import { useState } from 'react';
import { BrandStyles, Logo } from './Brand.js';
import { useConnection } from './useConnection.js';
import { useVersion } from './useVersion.js';
import { WorkspaceMark, WorkspaceMarkStyles } from './WorkspaceMark.js';
const KEYS_URL = 'https://app.vocalstack.com/developers/keys';
const muted = { color: 'var(--theme-elevation-500)' };
/** The installed version, and the newer one when there is one. */
const VersionLine = () => {
    const version = useVersion();
    if (!version)
        return null;
    if (version.state !== 'outdated')
        return _jsxs("p", { style: { ...muted, fontSize: 13, margin: 0 }, children: ["@vocalstack/payload ", version.current] });
    return (_jsxs("div", { style: { background: 'var(--theme-warning-100)', borderRadius: 'var(--style-radius-s, 4px)', fontSize: 13, padding: '10px 12px' }, children: [_jsxs("strong", { children: ["@vocalstack/payload ", version.latest, " is out."] }), " This site runs ", version.current, ".", ' ', version.releaseURL && (_jsx("a", { href: version.releaseURL, rel: "noreferrer", target: "_blank", children: "What's new" })), _jsxs("p", { style: { margin: '6px 0 0' }, children: ["Update it in the site's code (", _jsx("code", { children: "pnpm up @vocalstack/payload" }), "), then run ", _jsx("code", { children: "payload generate:importmap" }), " and, with Postgres or SQLite,", ' ', _jsx("code", { children: "payload migrate:create" }), " before deploying."] })] }));
};
/** The workspace the key works in: its mark and name under a "Workspace" label, with room for a button beside it. */
const WorkspaceRow = ({ children, workspace }) => (_jsxs("div", { style: { alignItems: 'center', display: 'flex', gap: 12 }, children: [_jsx(WorkspaceMarkStyles, {}), _jsx(WorkspaceMark, { size: 40, workspace: workspace }), _jsxs("div", { "aria-label": `Workspace: ${workspace.name}`, role: "group", style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { style: { ...muted, fontSize: 11, fontWeight: 600, letterSpacing: '.08em', lineHeight: 1.4, textTransform: 'uppercase' }, children: "Workspace" }), _jsx("div", { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: workspace.name })] }), children] }));
export const ConnectionPanel = ({ oneClickConnect }) => {
    const { call, cancel, connect, connecting, connection, setConnection } = useConnection();
    const [apiKey, setAPIKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState();
    const run = async (fn, done) => {
        setSaving(true);
        setError(undefined);
        try {
            setConnection(await fn());
            setAPIKey('');
            toast.success(done);
        }
        catch (err) {
            setError(err.message);
        }
        finally {
            setSaving(false);
        }
    };
    const save = () => void run(() => call('/vocalstack/key', { body: JSON.stringify({ apiKey }), method: 'POST' }), 'Connected to VocalStack.');
    if (!connection)
        return _jsx("p", { style: muted, children: "Checking the VocalStack connection\u2026" });
    return (_jsxs("div", { className: "vs-brand", style: { display: 'grid', gap: 'var(--base)', marginBottom: 'calc(var(--base) * 2)', maxWidth: 560 }, children: [_jsx(BrandStyles, {}), _jsx(Logo, { height: 24 }), connection.source === 'options' ? (_jsxs(_Fragment, { children: [connection.workspace && _jsx(WorkspaceRow, { workspace: connection.workspace }), _jsx("p", { style: { margin: 0 }, children: "Connected with the API key from the plugin config. Change it there." })] })) : connection.connected ? (_jsxs(_Fragment, { children: [connection.workspace ? (_jsxs(_Fragment, { children: [_jsx(WorkspaceRow, { workspace: connection.workspace, children: oneClickConnect && (_jsx(Button, { "aria-label": connecting ? 'Cancel changing the workspace' : 'Change workspace', buttonStyle: "secondary", disabled: saving, margin: false, onClick: () => {
                                        setError(undefined);
                                        void (connecting ? cancel() : connect().catch((e) => setError(e.message)));
                                    }, size: "small", children: connecting ? 'Cancel' : 'Change' })) }), _jsx("p", { style: { margin: 0 }, children: "Connected to VocalStack. Audio uploads have a Transcribe button, and what is transcribed here is kept in this workspace and uses its credit." }), oneClickConnect && (_jsx("p", { style: { ...muted, fontSize: 13, margin: 0 }, children: connecting ? ('Choose a workspace in the VocalStack tab, then click Authenticate. Until then this workspace stays connected.') : (_jsxs(_Fragment, { children: ["Change connects again, to the workspace you pick in VocalStack. That makes a new API key; the old one keeps working until it is revoked in VocalStack under", ' ', _jsx("a", { href: KEYS_URL, rel: "noreferrer", target: "_blank", children: "Developers \u2192 API keys" }), ". Transcripts made in another workspace stay in it."] })) }))] })) : (_jsxs("p", { style: { margin: 0 }, children: ["Connected to VocalStack", connection.account ? ` as ${connection.account}` : '', ". Audio uploads now have a Transcribe button."] })), _jsx("div", { children: _jsx(Button, { buttonStyle: "secondary", disabled: saving || connecting, margin: false, onClick: () => run(() => call('/vocalstack/key', { method: 'DELETE' }), 'Disconnected.'), children: "Disconnect" }) })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { style: { margin: 0 }, children: "Connect a VocalStack workspace to transcribe audio uploads. Transcriptions are kept in that workspace and use its credit." }), oneClickConnect && (_jsxs("div", { children: [_jsx(Button, { disabled: connecting, margin: false, onClick: () => connect().catch((e) => setError(e.message)), children: connecting ? 'Waiting for VocalStack…' : 'Connect VocalStack' }), _jsx("p", { style: { ...muted, fontSize: 13, marginBottom: 0 }, children: "Opens VocalStack in a new tab; choose a workspace and click Authenticate there." })] })), _jsxs("div", { onKeyDown: (e) => {
                            if (e.key === 'Enter' && apiKey.trim()) {
                                e.preventDefault();
                                save();
                            }
                        }, style: { display: 'grid', gap: 'calc(var(--base) / 2)' }, children: [_jsx(TextInput, { label: oneClickConnect ? 'Or paste an API key' : 'API key', onChange: (e) => setAPIKey(e.target.value), path: "vocalstack-api-key", placeholder: "vs_key_\u2026", value: apiKey }), _jsxs("p", { style: { ...muted, fontSize: 13, margin: 0 }, children: ["Create one with Read and Write permissions under", ' ', _jsx("a", { href: KEYS_URL, rel: "noreferrer", target: "_blank", children: "Developers \u2192 API keys" }), ". It is stored on the server and never shown again."] }), _jsx("div", { children: _jsx(Button, { disabled: saving || !apiKey.trim(), margin: false, onClick: save, children: "Save key" }) })] })] })), error && _jsx("p", { style: { color: 'var(--theme-error-500)', margin: 0 }, children: error }), _jsx(VersionLine, {})] }));
};
