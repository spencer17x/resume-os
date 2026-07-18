import { expect, type Locator } from '@playwright/test'

type MotionWaitOptions = {
  subtree?: boolean
}

const MOTION_SETTLE_TIMEOUT_MS = 5_000
const APP_SURFACE_SETTLE_TIMEOUT_MS = 10_000

export async function waitForFiniteMotionToSettle(
  target: Locator,
  { subtree = false }: MotionWaitOptions = {}
) {
  await target.page().waitForTimeout(50)

  await expect.poll(() => target.evaluate((element, includeSubtree) =>
    element.getAnimations({ subtree: includeSubtree }).filter((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return Number.isFinite(Number(endTime))
        && (animation.pending || (animation.playState !== 'finished' && animation.playState !== 'idle'))
    }).length
  , subtree), {
    message: 'Finite application motion did not settle',
    timeout: MOTION_SETTLE_TIMEOUT_MS
  }).toBe(0)
}

export async function waitForAppSurfaceToSettle(target: Locator) {
  await target.page().waitForTimeout(50)

  await expect.poll(() => target.evaluate((element) => {
    const surface = element.closest<HTMLElement>('.desktop-window-motion, .mobile-app-frame')
    if (!surface) return { opacity: 'missing', unsettled: -1 }
    const unsettled = surface.getAnimations().filter((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime
      return Number.isFinite(Number(endTime))
        && (animation.pending || (animation.playState !== 'finished' && animation.playState !== 'idle'))
    }).length
    return { opacity: getComputedStyle(surface).opacity, unsettled }
  }), {
    message: 'Application surface did not reach its settled state',
    timeout: APP_SURFACE_SETTLE_TIMEOUT_MS
  }).toEqual({ opacity: '1', unsettled: 0 })
}
