// Unit test of the Civil survey importers and TIN in a real browser (DOMParser for LandXML).
import { build } from 'vite'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
const root = new URL('..', import.meta.url).pathname
const res = await build({ configFile: false, logLevel: 'warn', build: { write: false, minify: false, lib: { entry: root + 'tools/unit/survey.test.ts', formats: ['iife'], name: 'surveyTest' } } })
const code = (Array.isArray(res) ? res[0] : res).output[0].code
const fx = (n) => readFileSync(new URL('../../qa/fixtures/civil/' + n, import.meta.url), 'utf8')
const files = Object.fromEntries(['canal_survey_SYNTHETIC.csv', 'canal_survey_SYNTHETIC.xml', 'canal_survey_SYNTHETIC.geojson', 'canal_survey_SYNTHETIC.dxf'].map((n) => [n, fx(n)]))
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('pageerror', e.message))
await page.addScriptTag({ content: code })
const r = await page.evaluate((f) => window.runSurveyTests(f), files)
console.log(JSON.stringify(r, null, 1))
await browser.close()
