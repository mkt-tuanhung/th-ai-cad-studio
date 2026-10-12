// Clears the BIM and Interior stores of the QA web profile ("thcad-qa"), so the next e2e script starts from the
// sample model. Needed after e2e_fromcad.js: it puts the stores back in its session, but Chromium rate-limits
// writing large local-storage values to disk and the runner kills the app, so the last write may be lost.
// usage: qa/tools/rune2e.sh $PWD/qa/tools/reset_qa_profile.js 60
;(async () => {
  await window.thcadHostReady
  const set = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { if (k !== 'thcad.bim' && k !== 'thcad.interior') set.call(this, k, v) }
  localStorage.removeItem('thcad.bim')
  localStorage.removeItem('thcad.interior')
  await new Promise((r) => setTimeout(r, 5000))
  console.log('E2E PASS QA profile: BIM and Interior stores cleared')
  console.log('E2E DONE OK')
})()
