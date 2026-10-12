// Clears the BIM, Interior and Civil stores of the QA web profile ("thcad-qa"), so the next e2e script starts from the
// sample models. Needed after e2e_fromcad.js / e2e_route.js: it puts the stores back in its session, but Chromium rate-limits
// writing large local-storage values to disk and the runner kills the app, so the last write may be lost.
// usage: qa/tools/rune2e.sh $PWD/qa/tools/reset_qa_profile.js 60
;(async () => {
  await window.thcadHostReady
  const set = Storage.prototype.setItem
  const keys = ['thcad.bim', 'thcad.interior', 'thcad.civil']
  Storage.prototype.setItem = function (k, v) { if (!keys.includes(k)) set.call(this, k, v) }
  for (const k of keys) localStorage.removeItem(k)
  await new Promise((r) => setTimeout(r, 5000))
  console.log('E2E PASS QA profile: BIM, Interior and Civil stores cleared')
  console.log('E2E DONE OK')
})()
