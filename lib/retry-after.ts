export function parseRetryAfter(value: string | null | undefined, now = Date.now()) {
  if (!value) return 0
  if (/^\d+$/.test(value)) return Math.min(3_600, Math.max(1, Number(value)))
  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return 0
  return Math.min(3_600, Math.max(1, Math.ceil((retryAt - now) / 1_000)))
}
