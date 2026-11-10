'use client'

import { useConfig } from '@payloadcms/ui'

import { SETTINGS_SLUG } from '../settings.js'
import { BrandStyles, Mark } from './Brand.js'
import { useVersion } from './useVersion.js'

/** In the admin nav, only while a newer version is out: links to Settings → VocalStack. */
export const UpdateNotice: React.FC = () => {
  const version = useVersion()
  const {
    config: {
      routes: { admin },
    },
  } = useConfig()
  if (version?.state !== 'outdated') return null
  return (
    <a
      className="vs-brand"
      href={`${admin}/globals/${SETTINGS_SLUG}`}
      style={{
        alignItems: 'center',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-s, 4px)',
        color: 'inherit',
        display: 'flex',
        fontSize: 13,
        gap: 8,
        lineHeight: 1.3,
        marginTop: 'var(--base)',
        padding: '8px 10px',
        textDecoration: 'none',
      }}
      title={`@vocalstack/payload ${version.current} is installed; ${version.latest} is out.`}
    >
      <BrandStyles />
      <Mark height={14} />
      <span>
        VocalStack {version.latest} is out
        <span style={{ color: 'var(--theme-elevation-500)', display: 'block' }}>You have {version.current}</span>
      </span>
    </a>
  )
}
