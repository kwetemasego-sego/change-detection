// The full validation: runs all eight sites from VALIDATION.md on real satellite
// images and checks each result. Takes about 3 to 10 minutes.
// Run it with: npm run test:validation
// The numbers for every site are saved in test-output/validation.json.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { openSite } = require("./helpers.js");
const { SITES, runSite } = require("./sites.js");

// What a good result looks like for each site (the "check" in sites.js)
const EXPECTED = {
  "khalifa-city-south": function (n) {
    assert.ok(n.regions.whitePlotChangedM2 >= 20000, "at least 2 ha of the white plot is flagged");
  },
  "lulu-island": function (n) {
    assert.ok(n.builtM2 >= 80000, "at least 8 ha of new buildings or bare ground on the earthworks");
  },
  "masdar": function (n) {
    assert.ok(n.regions.solarFieldChangedM2 <= 15000, "at most 1.5 ha flagged on the solar field (was about 3 ha)");
  },
  "al-khalidiyah": function (n) {
    assert.ok(n.changedPercent < 1, "under 1% of a finished neighbourhood is flagged");
  },
  "al-mushrif": function (n) {
    assert.ok(n.yearCheck, "the year-apart check ran");
    assert.ok(n.yearCheck.probablySeasonalM2 >= 0.5 * n.yearCheck.plantChangeM2, "at least half the plant change is probably seasonal");
  },
  "khalifa-city-a": function (n) {
    assert.ok(n.changedPercent < 1, "under 1% of a finished neighbourhood is flagged");
  },
  "riyadh-city": function (n) {
    assert.ok(n.changedPercent >= 1, "the new villas are found");
  },
  "dubai-solar-park": function (n) {
    assert.ok(n.builtM2 >= 150000, "at least 15 ha where panels were put back");
    assert.ok(n.builtM2 <= 400000, "the rest of the panel field is left alone");
  }
};
// Known misses: reported, but they don't make the whole run fail
const KNOWN_MISSES = {
  "riyadh-city": "single villas are about one 10 m square, too small to find (see VALIDATION.md)"
};

let site;
const results = {};
before(async function () { site = await openSite(); });
after(async function () {
  await site.close();
  const folder = path.join(__dirname, "..", "test-output");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "validation.json"), JSON.stringify(results, null, 1));
});

for (const s of SITES) {
  test(s.name + ": " + s.check, { timeout: 900000, todo: KNOWN_MISSES[s.id] }, async function () {
    const numbers = await runSite(site.page, s);
    results[s.id] = numbers;
    console.log(s.id + " " + JSON.stringify(numbers));
    assert.equal(numbers.sameView, true, "before and after are from the same satellite path");
    EXPECTED[s.id](numbers);
  });
}
