'use client'

import { BRAND, LOGO_DARK, LOGO_LIGHT, MARK_DARK, MARK_LIGHT } from './brandAssets.js'

/**
 * Brand colors as CSS variables, and the light/dark artwork swap, following
 * Payload's theme (`html[data-theme]`). Rendered once per component tree; repeats are harmless.
 */
export const BrandStyles = () => (
  <style>{`
    .vs-brand { --vs-accent: ${BRAND.blue}; --vs-coral: ${BRAND.coral}; }
    html[data-theme='dark'] .vs-brand { --vs-accent: ${BRAND.lightBlue}; --vs-coral: ${BRAND.lightCoral}; }
    .vs-art { display: inline-flex; line-height: 0; }
    .vs-art svg { height: 100%; width: auto; }
    html[data-theme='dark'] .vs-art--light, html:not([data-theme='dark']) .vs-art--dark { display: none; }
  `}</style>
)

const Art: React.FC<{ dark: string; height: number; label?: string; light: string }> = ({ dark, height, label, light }) => (
  <span aria-label={label} role={label ? 'img' : undefined} style={{ display: 'inline-flex', verticalAlign: 'middle' }}>
    <span className="vs-art vs-art--light" dangerouslySetInnerHTML={{ __html: light }} style={{ height }} />
    <span className="vs-art vs-art--dark" dangerouslySetInnerHTML={{ __html: dark }} style={{ height }} />
  </span>
)

/** The VocalStack wordmark. */
export const Logo: React.FC<{ height?: number }> = ({ height = 16 }) => <Art dark={LOGO_DARK} height={height} label="VocalStack" light={LOGO_LIGHT} />

/** The V on its own, for small spaces. */
export const Mark: React.FC<{ height?: number }> = ({ height = 14 }) => <Art dark={MARK_DARK} height={height} light={MARK_LIGHT} />
