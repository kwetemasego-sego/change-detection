// The validation sites (see VALIDATION.md), and a function that runs the site
// on one of them exactly as a user would: choose the area and dates, press
// Find images, then Compare with a year earlier.
// These use real Sentinel-2 images from Microsoft Planetary Computer, so they
// need the internet and take a minute or two per site.

const BEFORE_DATE = "2026-07-03";
const AFTER_DATE = "2026-10-01";

// Each site is a box about 2 km across around its centre. "regions" are parts of
// the box (as fractions of its width and height: left, right, top, bottom) that
// are measured separately. "check" says what a good result looks like.
const SITES = [
  {
    id: "khalifa-city-south", name: "Khalifa City south (cleared plot)", lat: 24.3902, lng: 54.5501,
    regions: { whitePlot: [0.40, 0.62, 0.52, 0.70] },
    check: "most of the white plot is found as a bright new surface"
  },
  { id: "lulu-island", name: "Lulu Island", lat: 24.4943, lng: 54.3450, check: "the earthworks are found" },
  {
    id: "masdar", name: "Masdar City", lat: 24.4270, lng: 54.6150,
    regions: { solarField: [0.05, 0.37, 0, 0.2] },
    check: "the solar panel field is mostly left alone"
  },
  { id: "al-khalidiyah", name: "Al Khalidiyah", lat: 24.4690, lng: 54.3500, check: "under 1% flagged" },
  { id: "al-mushrif", name: "Al Mushrif park", lat: 24.4560, lng: 54.3860, check: "most plant change is marked probably seasonal" },
  { id: "khalifa-city-a", name: "Khalifa City A", lat: 24.4200, lng: 54.5750, check: "under 1% flagged" },
  { id: "riyadh-city", name: "Riyadh City new villas", lat: 24.2772, lng: 54.6388, check: "the new villas are found (a known miss)" },
  { id: "dubai-solar-park", name: "Dubai solar park", lat: 24.7091, lng: 55.4439, check: "the blocks where panels were put back are found" },
  { id: "jebel-hafeet", name: "Jebel Hafeet (mountain)", lat: 24.0590, lng: 55.7760, check: "sunlit slopes aren't counted as bright new surface" }
];

// Runs one site and returns its numbers (areas in m², percentages of the compared area)
async function runSite(page, site) {
  // The image service sometimes drops a request or is busy, so try up to 3 times
  for (let attempt = 1; ; attempt++) {
    try {
      return await runSiteOnce(page, site);
    } catch (error) {
      if (attempt >= 3) throw error;
      // Wait before trying again (30 s, then 60 s), so a busy service has time
      // to recover instead of being asked again straight away
      const wait = 30 * attempt;
      console.log(site.id + ": attempt " + attempt + " failed (" + error.message + "), trying again in " + wait + " s");
      await new Promise(function (resolve) { setTimeout(resolve, wait * 1000); });
      await page.reload({ waitUntil: "networkidle2" });
    }
  }
}

async function runSiteOnce(page, site) {
  await page.waitForFunction(function () { return !document.getElementById("find-button").disabled; }, { timeout: 600000 });
  await page.evaluate(function (site, beforeDate, afterDate) {
    lastResult = null;
    setArea(L.latLngBounds([[site.lat - 0.009, site.lng - 0.0099], [site.lat + 0.009, site.lng + 0.0099]]));
    document.getElementById("before-date").value = beforeDate;
    document.getElementById("after-date").value = afterDate;
    document.getElementById("find-button").click();
  }, site, BEFORE_DATE, AFTER_DATE);
  await page.waitForFunction(function () {
    return lastResult || /Sorry|No image/.test(document.getElementById("status-text").textContent);
  }, { timeout: 400000 });
  const failed = await page.evaluate(function () { return !lastResult && document.getElementById("status-text").textContent; });
  if (failed) throw new Error(failed);

  const seasonWarning = await page.evaluate(function () { return !document.getElementById("season-note").hidden; });
  if (seasonWarning) {
    await page.click("#year-check-button");
    await page.waitForFunction(function () {
      return (lastResult && lastResult.yearCheck) || /Sorry|No image/.test(document.getElementById("year-check-text").textContent);
    }, { timeout: 400000 });
    const checkFailed = await page.evaluate(function () {
      return !lastResult.yearCheck && document.getElementById("year-check-text").textContent;
    });
    if (checkFailed) throw new Error("year-apart check: " + checkFailed);
  }

  return page.evaluate(function (regions) {
    const result = lastResult;
    const compared = result.counts[NO_CHANGE] + result.counts[PLANTS_GAINED] + result.counts[PLANTS_LOST] +
      result.counts[NEW_BUILT_OR_BARE] + result.counts[BURNED];
    const changed = compared - result.counts[NO_CHANGE];
    const m2 = function (squares) { return squares * SQUARE_AREA_M2; };
    const numbers = {
      beforeImage: describeImage(result.before), afterImage: describeImage(result.after), sameView: result.sameView,
      plantsGainedM2: m2(result.counts[PLANTS_GAINED]), plantsLostM2: m2(result.counts[PLANTS_LOST]),
      builtM2: m2(result.counts[NEW_BUILT_OR_BARE]), burnedM2: m2(result.counts[BURNED]),
      brightM2: m2(result.brightSquares), changedPercent: (100 * changed) / compared,
      seasonWarning: !document.getElementById("season-note").hidden, yearCheck: null, regions: {}
    };
    if (result.yearCheck) {
      numbers.yearCheck = {
        image: describeImage(result.yearCheck.before), sameView: result.yearCheck.sameView,
        plantChangeM2: m2(result.yearCheck.seasonal.plantSquares),
        probablySeasonalM2: m2(result.yearCheck.seasonal.seasonalSquares)
      };
    }
    // Changed squares (any kind) inside each region
    const grid = result.grid;
    for (const [name, [left, right, top, bottom]] of Object.entries(regions || {})) {
      let squares = 0;
      for (let row = Math.floor(top * grid.rows); row < bottom * grid.rows; row++) {
        for (let column = Math.floor(left * grid.columns); column < right * grid.columns; column++) {
          const kind = result.kinds[row * grid.columns + column];
          if (kind !== NO_CHANGE && kind !== SKIPPED) squares++;
        }
      }
      numbers.regions[name + "ChangedM2"] = m2(squares);
    }
    return numbers;
  }, site.regions);
}

module.exports = { SITES, runSite };
