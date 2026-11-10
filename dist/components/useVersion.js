'use client';
import { useEffect, useState } from 'react';
import { useAPI } from './useConnection.js';
// One ask per page load, shared by the nav and the settings panel.
let asked;
/** This plugin's version against the newest on npm (the server asks npm, and keeps the answer). */
export function useVersion() {
    const call = useAPI();
    const [version, setVersion] = useState();
    useEffect(() => {
        let live = true;
        asked ??= call('/vocalstack/version').catch(() => {
            asked = undefined;
            return undefined;
        });
        void asked.then((v) => live && setVersion(v));
        return () => {
            live = false;
        };
    }, [call]);
    return version;
}
