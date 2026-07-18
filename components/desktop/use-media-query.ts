'use client'

import { useSyncExternalStore } from 'react'

export const MOBILE_MEDIA_QUERY = '(max-width: 767px)'

export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => null
  )
}
