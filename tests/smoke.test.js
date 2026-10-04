// Quick end-to-end test on real satellite images: runs the Khalifa City south
// site, which uses most of the change rules (plants gained, bright new surface,
// the seasonal warning and the year-apart check). Takes one to three minutes.
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
