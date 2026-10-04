// Quick end-to-end test on real satellite images: runs the Khalifa City south
// site, which uses most of the change rules (plants gained, bright new surface,
// the seasonal warning and the year-apart check). Takes about 20 to 40 seconds.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openSite } = require("./helpers.js");
const { SITES, runSite } = require("./sites.js");

let site;
before(async function () { site = await openSite(); });
after(async function () { await site.close(); });

test("Khalifa City south: the white plot is found and the seasons are checked", { timeout: 900000 }, async function () {
  const numbers = await runSite(site.page, SITES.find(function (s) { return s.id === "khalifa-city-south"; }));
  console.log(JSON.stringify(numbers, null, 1));

  assert.equal(numbers.sameView, true, "before and after are from the same satellite path");
  assert.ok(numbers.regions.whitePlotChangedM2 >= 20000, "at least 2 ha of the white plot is flagged");
  assert.ok(numbers.brightM2 >= 30000, "at least 3 ha found as bright new surface");
  assert.ok(numbers.plantsGainedM2 >= 30000, "the greening strip is found as plants gained");
  assert.equal(numbers.seasonWarning, true, "July and September are different seasons");
  assert.ok(numbers.yearCheck, "the year-apart check ran");
  assert.ok(numbers.yearCheck.probablySeasonalM2 > 0, "some plant change is marked probably seasonal");
  assert.deepEqual(site.pageErrors, []);
});

test("a shared link to Khalifa City south gives the same result", { timeout: 900000 }, async function () {
  const page = await site.browser.newPage();
  const errors = [];
  page.on("pageerror", function (error) { errors.push(error.message); });
  // The link that "Copy link" makes for the box runSite uses around 24.3902, 54.5501
  await page.goto(site.url + "?area=24.38120,54.54020,24.39920,54.56000&before=2026-07-03&after=2026-10-01", { waitUntil: "load" });
  // The image service sometimes drops a request: if so, press Find images again (up to 3 times)
  for (let attempt = 1; ; attempt++) {
    await page.waitForFunction(function () {
      return lastResult || /Sorry|No image/.test(document.getElementById("status-text").textContent);
    }, { timeout: 400000 });
    if (await page.evaluate(function () { return Boolean(lastResult); }) || attempt >= 3) break;
    await page.click("#find-button");
  }
  const result = await page.evaluate(function () {
    return { brightSquares: lastResult.brightSquares, plantsGained: lastResult.counts[PLANTS_GAINED] };
  });
  assert.ok(result.brightSquares >= 300, "at least 3 ha of bright new surface, as when the area is chosen by hand");
  assert.ok(result.plantsGained >= 300, "the greening strip is found");
  assert.deepEqual(errors, []);
  await page.close();
});
