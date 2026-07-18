'use client'

import { useEffect } from 'react'
import type { AppId } from '@/lib/desktop/types'
import { useDesktop } from './desktop-provider'
import { MOBILE_MEDIA_QUERY, useMediaQuery } from './use-media-query'

export function DesktopRoute({
  appId,
  desktopOnly = false
}: {
  appId: AppId
  desktopOnly?: boolean
}) {
  const { openApp } = useDesktop()
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY)

  useEffect(() => {
    if (isMobile === null) return
    if (!desktopOnly || !isMobile) openApp(appId)
  }, [appId, desktopOnly, isMobile, openApp])

  return null
}
