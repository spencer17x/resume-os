export const LEGACY_BRAND_PREFIX = 'resume-os'

export function readMigratedStorageValue(
  storage: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>,
  currentKey: string,
  legacyKey: string
) {
  const current = storage.getItem(currentKey)
  if (current !== null) return current
  const legacy = storage.getItem(legacyKey)
  if (legacy === null) return null
  try {
    storage.setItem?.(currentKey, legacy)
  } catch {
    // The legacy value remains readable when migration writes are unavailable.
  }
  return legacy
}
