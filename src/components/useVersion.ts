'use client'

import { useEffect, useState } from 'react'

import type { VersionResponse } from '../types.js'

import { useAPI } from './useConnection.js'

// One ask per page load, shared by the nav and the settings panel.
let asked: Promise<VersionResponse | undefined> | undefined

/** This plugin's version against the newest on npm (the server asks npm, and keeps the answer). */
export function useVersion(): VersionResponse | undefined {
  const call = useAPI()
  const [version, setVersion] = useState<VersionResponse>()
  useEffect(() => {
    let live = true
    asked ??= call<VersionResponse>('/vocalstack/version').catch(() => {
      asked = undefined
      return undefined
    })
    void asked.then((v) => live && setVersion(v))
    return () => {
      live = false
    }
  }, [call])
  return version
}
