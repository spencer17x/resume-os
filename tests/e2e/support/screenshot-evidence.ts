import { expect, type Page } from '@playwright/test'

export async function expectNoDevelopmentOverlay(page: Page) {
  await expect.poll(async () => page.locator('nextjs-portal').evaluateAll((portals) => portals.every((portal) => {
    const root = portal.shadowRoot
    if (!root) return true

    return Array.from(root.querySelectorAll<HTMLElement>('*')).every((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width === 0
        || rect.height === 0
        || style.display === 'none'
        || style.visibility === 'hidden'
        || Number(style.opacity) === 0
    })
  }))).toBe(true)
}

export async function expectReadableScreenshot(page: Page, image: Buffer) {
  const metrics = await page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const probe = document.createElement('canvas')
    probe.width = bitmap.width
    probe.height = bitmap.height
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D screenshot evidence context unavailable')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()

    const pixels = context.getImageData(0, 0, probe.width, probe.height).data
    const colors = new Set<string>()
    let sampled = 0
    let black = 0
    let transparent = 0
    for (let y = 0; y < probe.height; y += 8) {
      for (let x = 0; x < probe.width; x += 8) {
        const offset = (y * probe.width + x) * 4
        const red = pixels[offset]
        const green = pixels[offset + 1]
        const blue = pixels[offset + 2]
        const alpha = pixels[offset + 3]
        sampled += 1
        if (alpha < 250) transparent += 1
        if (alpha >= 250 && red < 4 && green < 4 && blue < 4) black += 1
        colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`)
      }
    }

    return {
      blackRatio: black / sampled,
      transparentRatio: transparent / sampled,
      variedColors: colors.size
    }
  }, image.toString('base64'))

  expect(metrics.transparentRatio).toBeLessThan(0.001)
  expect(metrics.blackRatio).toBeLessThan(0.08)
  expect(metrics.variedColors).toBeGreaterThan(24)
}
