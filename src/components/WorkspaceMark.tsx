'use client'

import { useState } from 'react'

import type { Workspace } from '../workspace.js'

import { workspaceHue, workspaceInitials } from '../workspaceMark.js'

const PERSON =
  'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z'

/** The mark's looks, as in the VocalStack Dashboard, on Payload's theme colours. */
export const WorkspaceMarkStyles = () => (
  <style>{`
    .vs-wsmark { flex: none; display: grid; place-items: center; font-weight: 600; letter-spacing: .02em; line-height: 1; --ws-c: oklch(.66 .13 var(--ws-h, 252)); background: color-mix(in oklab, var(--ws-c) 22%, transparent); color: color-mix(in oklab, var(--ws-c) 72%, var(--theme-text)); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ws-c) 30%, transparent); }
    .vs-wsmark--me { background: var(--theme-elevation-100); color: var(--theme-elevation-650); box-shadow: inset 0 0 0 1px var(--theme-elevation-150); }
    .vs-wsmark--img { overflow: hidden; background: var(--theme-elevation-50); box-shadow: inset 0 0 0 1px var(--theme-elevation-150); }
    .vs-wsmark--img img { display: block; width: 100%; height: 100%; object-fit: cover; }
  `}</style>
)

/**
 * A workspace's mark, as the VocalStack Dashboard draws it: its own icon when it has
 * one, a person for the personal workspace, else its initials on its colour.
 */
export const WorkspaceMark: React.FC<{ size?: number; workspace: Workspace }> = ({ size = 28, workspace }) => {
  // An icon that does not load (its link ran out, the network) gives way to the drawn mark.
  const [broken, setBroken] = useState<string>()
  const style = { borderRadius: Math.round(size * 0.29), fontSize: Math.round(size * 0.39), height: size, width: size }
  const icon = workspace.iconUrl && workspace.iconUrl !== broken ? workspace.iconUrl : undefined
  if (icon) {
    return (
      <span aria-hidden="true" className="vs-wsmark vs-wsmark--img" style={style}>
        <img alt="" draggable={false} onError={() => setBroken(icon)} src={icon} />
      </span>
    )
  }
  if (workspace.personal) {
    const glyph = Math.round(size * 0.55)
    return (
      <span aria-hidden="true" className="vs-wsmark vs-wsmark--me" style={style}>
        <svg fill="none" height={glyph} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} viewBox="0 0 24 24" width={glyph}>
          <path d={PERSON} />
        </svg>
      </span>
    )
  }
  return (
    <span aria-hidden="true" className="vs-wsmark" style={{ ...style, '--ws-h': workspaceHue(workspace.id) } as React.CSSProperties}>
      {workspaceInitials(workspace.name)}
    </span>
  )
}
