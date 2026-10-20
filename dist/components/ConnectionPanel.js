'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Button, TextInput, toast } from '@payloadcms/ui';
import { useState } from 'react';
import { BrandStyles, Logo } from './Brand.js';
import { useConnection } from './useConnection.js';
const KEYS_URL = 'https://app.vocalstack.com/developers/keys';
export const ConnectionPanel = ({ oneClickConnect }) => {
    const { call, connect, connecting, connection, setConnection } = useConnection();
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
    const muted = { color: 'var(--theme-elevation-500)' };
    if (!connection)
        return _jsx("p", { style: muted, children: "Checking the VocalStack connection\u2026" });
    if (connection.source === 'options') {
        return _jsx("p", { style: muted, children: "Connected with the API key from the plugin config. Change it there." });
    }
    return (_jsxs("div", { className: "vs-brand", style: { display: 'grid', gap: 'var(--base)', marginBottom: 'calc(var(--base) * 2)', maxWidth: 560 }, children: [_jsx(BrandStyles, {}), _jsx(Logo, { height: 24 }), connection.connected ? (_jsxs(_Fragment, { children: [_jsxs("p", { style: { margin: 0 }, children: ["Connected to VocalStack", connection.account ? ` as ${connection.account}` : '', ". Audio uploads now have a Transcribe button."] }), _jsx("div", { children: _jsx(Button, { buttonStyle: "secondary", disabled: saving, margin: false, onClick: () => run(() => call('/vocalstack/key', { method: 'DELETE' }), 'Disconnected.'), children: "Disconnect" }) })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { style: { margin: 0 }, children: "Connect a VocalStack account to transcribe audio uploads. Transcriptions use that account's credit." }), oneClickConnect && (_jsxs("div", { children: [_jsx(Button, { disabled: connecting, margin: false, onClick: () => connect().catch((e) => setError(e.message)), children: connecting ? 'Waiting for VocalStack…' : 'Connect VocalStack' }), _jsx("p", { style: { ...muted, fontSize: 13, marginBottom: 0 }, children: "Opens VocalStack in a new tab; click Authenticate there." })] })), _jsxs("div", { onKeyDown: (e) => {
                            if (e.key === 'Enter' && apiKey.trim()) {
                                e.preventDefault();
                                save();
                            }
                        }, style: { display: 'grid', gap: 'calc(var(--base) / 2)' }, children: [_jsx(TextInput, { label: oneClickConnect ? 'Or paste an API key' : 'API key', onChange: (e) => setAPIKey(e.target.value), path: "vocalstack-api-key", placeholder: "vs_key_\u2026", value: apiKey }), _jsxs("p", { style: { ...muted, fontSize: 13, margin: 0 }, children: ["Create one with Read and Write permissions under", ' ', _jsx("a", { href: KEYS_URL, rel: "noreferrer", target: "_blank", children: "Developers \u2192 API keys" }), ". It is stored on the server and never shown again."] }), _jsx("div", { children: _jsx(Button, { disabled: saving || !apiKey.trim(), margin: false, onClick: save, children: "Save key" }) })] })] })), error && _jsx("p", { style: { color: 'var(--theme-error-500)', margin: 0 }, children: error })] }));
};
