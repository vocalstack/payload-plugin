'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BRAND, LOGO_DARK, LOGO_LIGHT, MARK_DARK, MARK_LIGHT } from './brandAssets.js';
/**
 * Brand colors as CSS variables, and the light/dark artwork swap, following
 * Payload's theme (`html[data-theme]`). Rendered once per component tree; repeats are harmless.
 */
export const BrandStyles = () => (_jsx("style", { children: `
    .vs-brand { --vs-accent: ${BRAND.blue}; --vs-coral: ${BRAND.coral}; }
    html[data-theme='dark'] .vs-brand { --vs-accent: ${BRAND.lightBlue}; --vs-coral: ${BRAND.lightCoral}; }
    .vs-art { display: inline-flex; line-height: 0; }
    .vs-art svg { height: 100%; width: auto; }
    html[data-theme='dark'] .vs-art--light, html:not([data-theme='dark']) .vs-art--dark { display: none; }
  ` }));
const Art = ({ dark, height, label, light }) => (_jsxs("span", { "aria-label": label, role: label ? 'img' : undefined, style: { display: 'inline-flex', verticalAlign: 'middle' }, children: [_jsx("span", { className: "vs-art vs-art--light", dangerouslySetInnerHTML: { __html: light }, style: { height } }), _jsx("span", { className: "vs-art vs-art--dark", dangerouslySetInnerHTML: { __html: dark }, style: { height } })] }));
/** The VocalStack wordmark. */
export const Logo = ({ height = 16 }) => _jsx(Art, { dark: LOGO_DARK, height: height, label: "VocalStack", light: LOGO_LIGHT });
/** The V on its own, for small spaces. */
export const Mark = ({ height = 14 }) => _jsx(Art, { dark: MARK_DARK, height: height, light: MARK_LIGHT });
