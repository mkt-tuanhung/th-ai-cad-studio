// Installer art from the InstallerWelcomeScreen hero and the DMG background (#/brand?shot=…), so the real
// installers match the in-app brand. Needs the dev server. Output (committed):
//   native/packaging/windows/art/wizard-<scale>.bmp, small-<scale>.bmp   (Inno Setup, per DPI)
//   native/packaging/macos/art/dmg-background.tiff                          (660×420 + @2x)
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = new URL('../../', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'md-art-'))
const browser = await chromium.launch()
const shot = async (shotName, w, h, scale, file) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
  const page = await ctx.newPage()
  await page.goto(`${process.env.THCAD_UI ?? 'http://127.0.0.1:5173'}/?splash=0#/brand?shot=${shotName}`)
  await page.waitForTimeout(2600) // entrance animations settle
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } })
  await ctx.close()
}
const bmp = (png, out, w, h) => execFileSync('sips', ['-s', 'format', 'bmp', '-z', String(h), String(w), png, '--out', out], { stdio: 'ignore' })
// Inno Setup modern wizard: left image 164×314 at 100 %, up to 410×797 at 250 %
const wizard = [[100, 164, 314], [125, 192, 386], [150, 246, 459], [175, 273, 556], [200, 328, 604], [225, 355, 700], [250, 410, 797]]
for (const [pct, w, h] of wizard) {
  const png = join(tmp, `wizard-${pct}.png`)
  await shot('hero', w, h, 1, png)
  bmp(png, join(root, `native/packaging/windows/art/wizard-${pct}.bmp`), w, h)
}
// small image (top right of the inner pages): the app icon, 55×55 at 100 %
const icon = join(root, 'ui/public/assets/branding/md-app-icon-1024.png')
for (const [pct, n] of [[100, 55], [125, 64], [150, 83], [175, 92], [200, 110], [225, 119], [250, 138]]) bmp(icon, join(root, `native/packaging/windows/art/small-${pct}.bmp`), n, n)
// DMG background, 1× and 2× in one TIFF (Finder picks the right one)
const d1 = join(tmp, 'dmg.png'), d2 = join(tmp, 'dmg@2x.png')
await shot('dmg', 660, 420, 1, d1)
await shot('dmg', 660, 420, 2, d2)
execFileSync('tiffutil', ['-cathidpicheck', d1, d2, '-out', join(root, 'native/packaging/macos/art/dmg-background.tiff')], { stdio: 'ignore' })
execFileSync('cp', [d2, join(root, 'native/packaging/macos/art/dmg-background@2x.png')])
await browser.close()
console.log('installer art written')
