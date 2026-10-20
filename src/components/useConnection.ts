'use client'

import { useConfig } from '@payloadcms/ui'
import { useCallback, useEffect, useState } from 'react'

import type { ConnectionResponse } from '../types.js'

export function useAPI() {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const base = `${serverURL}${api}`
  return useCallback(
    async <T>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`${base}${path}`, {
        credentials: 'include',
        ...init,
        headers: { 'content-type': 'application/json', ...init.headers },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), { code: body.code as string | undefined })
      return body as T
    },
    [base],
  )
}

/** The VocalStack connection, and the one-click flow that opens the dashboard in a new tab. */
export function useConnection() {
  const call = useAPI()
  const [connection, setConnection] = useState<ConnectionResponse>()
  const [connecting, setConnecting] = useState(false)

  const refresh = useCallback(() => call<ConnectionResponse>('/vocalstack/connection').then(setConnection, () => setConnection({ connected: false })), [call])

  useEffect(() => {
    void refresh()
    // The callback tab announces itself on this channel when it is done.
    let channel: BroadcastChannel | undefined
    try {
      channel = new BroadcastChannel('vocalstack')
      channel.onmessage = (e) => {
        if (e.data?.type === 'connect') {
          setConnecting(false)
          void refresh()
        }
      }
    } catch {}
    return () => channel?.close()
  }, [refresh])

  const connect = useCallback(async () => {
    // Open the tab inside the click, before any await, or the popup blocker eats it.
    const tab = window.open('about:blank', '_blank')
    setConnecting(true)
    try {
      const { url } = await call<{ url: string }>('/vocalstack/connect', { method: 'POST' })
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (err) {
      tab?.close()
      setConnecting(false)
      throw err
    }
  }, [call])

  return { call, connect, connecting, connection, refresh, setConnection }
}
