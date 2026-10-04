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

// Waits for the terrain of the chosen area, then returns its numbers
async function terrainOfChosenArea(page) {
  await page.waitForFunction(function () {
    return (lastTerrain && lastTerrain.area === chosenArea) || /Sorry/.test(document.getElementById("terrain-status").textContent);
  }, { timeout: 120000 });
  return page.evaluate(function () {
    if (!lastTerrain) return { error: document.getElementById("terrain-status").textContent };
    const t = lastTerrain;
    return { lowest: t.lowest, highest: t.highest, averageSlope: t.averageSlope, steepest: t.steepest,
      aspect: t.aspect, lowLyingShare: t.lowLyingShare, profilePoints: t.profile.length };
  });
}

test("terrain of flat Khalifa City south, and the PDF report includes it", { timeout: 900000 }, async function () {
  // The page still shows Khalifa City south from the first test
  const t = await terrainOfChosenArea(site.page);
  console.log("Khalifa City south terrain " + JSON.stringify(t));
  assert.ok(!t.error, t.error);
  assert.ok(t.highest < 50, "low coastal ground");
  assert.ok(t.averageSlope < 5, "flat on average");
  assert.ok(t.lowLyingShare > 0.3, "much of it under 5 m");
  assert.ok(t.profilePoints > 50, "a profile across the 2 km square");

  // The report's text has a Terrain section with the four results and the elevation credit
  const written = await site.page.evaluate(async function () {
    const lines = [];
    const Original = window.jspdf.jsPDF;
    window.jspdf.jsPDF = function (...args) {
      const doc = new Original(...args);
      const text = doc.text;
      doc.text = function (t, ...rest) { lines.push([].concat(t).join(" ")); return text.call(doc, t, ...rest); };
      return doc;
    };
    await makeReport(lastResult);
    window.jspdf.jsPDF = Original;
    return lines.join(" ");
  });
  for (const words of ["Terrain", "Elevation: lowest", "Slope: average", "Aspect:", "Low-lying:", "Copernicus DEM GLO-30"]) {
    assert.ok(written.includes(words), "the report mentions " + words);
  }
});

test("terrain of hilly Jebel Hafeet", { timeout: 300000 }, async function () {
  await site.page.evaluate(function () {
    setArea(squareAround(L.latLng(24.059, 55.776), 2));
  });
  const t = await terrainOfChosenArea(site.page);
  console.log("Jebel Hafeet terrain " + JSON.stringify(t));
  assert.ok(!t.error, t.error);
  assert.ok(t.highest > 900, "a mountain: higher than 900 m");
  assert.ok(t.highest - t.lowest > 400, "more than 400 m from bottom to top");
  assert.ok(t.averageSlope > 15, "steep on average");
  assert.ok(t.steepest > 40, "some very steep slopes");
  assert.equal(t.lowLyingShare, 0, "nothing low-lying");
  assert.ok(t.aspect, "slopes face a main direction");
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
