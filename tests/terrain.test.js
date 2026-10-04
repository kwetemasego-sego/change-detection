// Fast tests for the terrain numbers (on made-up heights), Click to analyse and
// the result tabs. Satellite images and the elevation model are blocked, so
// these take a few seconds and use no outside services.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openSite, openOfflinePage } = require("./helpers.js");

let site;
before(async function () { site = await openSite(); });
after(async function () { await site.close(); });

// Works out the terrain for made-up heights: height(row, column) in metres,
// on a grid of 30 m squares
function terrainOf(page, columns, rows, heightFormula) {
  return page.evaluate(function (columns, rows, formula) {
    const height = new Function("row", "column", "return " + formula);
    const heights = new Float32Array(columns * rows);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) heights[row * columns + column] = height(row, column);
    }
    const t = analyseHeights(heights, columns, rows, 30, 30);
    if (!t) return null;
    const middle = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
    return {
      lowest: t.lowest, highest: t.highest, average: t.average, averageSlope: t.averageSlope, steepest: t.steepest,
      aspect: t.aspect, lowLyingShare: t.lowLyingShare, middleShade: t.shade[middle],
      profile: t.profile.map(function (p) { return [p.metres, p.height]; }),
      lines: terrainLines(t)
    };
  }, columns, rows, heightFormula);
}

test("flat ground at 3 m: no slope, no direction, all low-lying", async function () {
  const t = await terrainOf(site.page, 10, 10, "3");
  assert.equal(t.lowest, 3);
  assert.equal(t.highest, 3);
  assert.equal(t.averageSlope, 0);
  assert.equal(t.steepest, 0);
  assert.equal(t.aspect, null);
  assert.equal(t.lowLyingShare, 1);
  assert.deepEqual(t.lines.map(function (line) { return line[0]; }), ["Elevation", "Slope", "Aspect", "Low-lying"]);
  assert.equal(t.lines[3][1], "100% of the area is less than 5 m above sea level");
  assert.match(t.lines[2][1], /^too flat to face any one way/);
});

test("ground rising 3 m every 30 m to the east: a 5.7° slope facing west", async function () {
  // 3 m per 30 m square = a rise of 1 in 10; atan(0.1) = 5.71°
  const t = await terrainOf(site.page, 10, 10, "3 * column");
  assert.ok(Math.abs(t.averageSlope - 5.71) < 0.01, "average slope " + t.averageSlope);
  assert.ok(Math.abs(t.steepest - 5.71) < 0.01);
  assert.deepEqual(t.aspect, { name: "west", share: 1 }, "downhill is to the west");
  assert.equal(t.lowLyingShare, 0.2, "columns 0 and 1 (0 m and 3 m) are under 5 m");
  assert.equal(t.lowest, 0);
  assert.equal(t.highest, 27);
  // The profile runs west to east along the middle row, one point per square
  assert.equal(t.profile.length, 10);
  assert.deepEqual(t.profile[0], [15, 0]);
  assert.deepEqual(t.profile[9], [285, 27]);
});

test("the main direction slopes face, for ground rising to the north and to the south-east", async function () {
  const risingNorth = await terrainOf(site.page, 10, 10, "100 - 5 * row"); // rows go south, so heights rise to the north
  assert.equal(risingNorth.aspect.name, "south");
  const risingSouthEast = await terrainOf(site.page, 10, 10, "2 * (row + column)");
  assert.equal(risingSouthEast.aspect.name, "north-west");
});

test("hillshade: slopes facing the north-west sun are brighter than slopes facing away", async function () {
  const facingSun = await terrainOf(site.page, 10, 10, "4 * (row + column)"); // faces north-west
  const facingAway = await terrainOf(site.page, 10, 10, "100 - 4 * (row + column)"); // faces south-east
  const flat = await terrainOf(site.page, 10, 10, "10");
  assert.ok(Math.abs(flat.middleShade - Math.sin(Math.PI / 4)) < 1e-6, "flat ground: lit by a sun 45° up");
  assert.ok(facingSun.middleShade > flat.middleShade);
  assert.ok(facingAway.middleShade < flat.middleShade);
});

test("missing heights are left out, and no heights at all gives nothing", async function () {
  const t = await terrainOf(site.page, 10, 10, "column < 5 ? NaN : 20");
  assert.equal(t.lowest, 20);
  assert.equal(t.lowLyingShare, 0);
  assert.equal(t.profile.length, 5, "only the squares with heights");
  assert.equal(await terrainOf(site.page, 4, 4, "NaN"), null);
});

test("a square around a point is the chosen size", async function () {
  const sizes = await site.page.evaluate(function () {
    return [1, 2, 5].map(function (km) {
      const box = squareAround(L.latLng(24.39, 54.55), km);
      return [
        Math.round(map.distance(box.getSouthWest(), box.getSouthEast())),
        Math.round(map.distance(box.getSouthWest(), box.getNorthWest())),
        box.getCenter().lat.toFixed(5), box.getCenter().lng.toFixed(5)
      ];
    });
  });
  for (const [k, km] of [1, 2, 5].entries()) {
    assert.ok(Math.abs(sizes[k][0] - km * 1000) < km * 5, km + " km wide: " + sizes[k][0] + " m");
    assert.ok(Math.abs(sizes[k][1] - km * 1000) < km * 5, km + " km tall: " + sizes[k][1] + " m");
    assert.deepEqual(sizes[k].slice(2), ["24.39000", "54.55000"]);
  }
});

// Clicks the map at a point (like a person would), and says where the area ended up
async function clickMapAt(page, lat, lng) {
  // Like a person, wait for the map to finish zooming to the last square before clicking again
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  const point = await page.evaluate(function (lat, lng) {
    map.setView([lat, lng], 13, { animate: false });
    const p = map.latLngToContainerPoint([lat, lng]);
    const box = map.getContainer().getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }, lat, lng);
  await page.mouse.click(point.x, point.y);
  // Wait (up to 3 seconds) for the click to choose an area there
  await page.waitForFunction(function (lat, lng) {
    return chosenArea && Math.abs(chosenArea.getCenter().lat - lat) < 0.001 && Math.abs(chosenArea.getCenter().lng - lng) < 0.001;
  }, { timeout: 3000 }, lat, lng).catch(function () {});
  return page.evaluate(function () {
    if (!chosenArea) return null;
    return {
      centre: [chosenArea.getCenter().lat, chosenArea.getCenter().lng],
      widthKm: map.distance(chosenArea.getSouthWest(), chosenArea.getSouthEast()) / 1000,
      dates: [beforeDateInput.value, afterDateInput.value],
      status: statusText.textContent,
      address: location.search
    };
  });
}

test("Click to analyse: off, a click does nothing; on, a click analyses a square around it", async function () {
  const { page, errors } = await openOfflinePage(site);
  assert.equal(await clickMapAt(page, 24.39, 54.55), null, "an ordinary click doesn't choose an area");

  await page.$eval("#click-mode-button", function (b) { b.click(); });
  assert.equal(await page.$eval("#click-mode-button", function (b) { return b.getAttribute("aria-pressed"); }), "true");
  const clicked = await clickMapAt(page, 24.39, 54.55);
  assert.ok(Math.abs(clicked.centre[0] - 24.39) < 0.001 && Math.abs(clicked.centre[1] - 54.55) < 0.001, "centred on the click");
  assert.ok(Math.abs(clicked.widthKm - 2) < 0.01, "2 km square by default");
  // The last 90 days
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  assert.deepEqual(clicked.dates, [ninetyDaysAgo, today]);
  assert.match(clicked.status, /Searching|Sorry/, "the search started");
  assert.match(clicked.address, /^\?area=/);

  // A 5 km square
  await page.waitForFunction(function () { return !findButton.disabled; });
  await page.select("#click-size", "5");
  const bigger = await clickMapAt(page, 24.45, 54.40);
  assert.ok(Math.abs(bigger.widthKm - 5) < 0.02, "5 km square: " + JSON.stringify(bigger));

  // Dates you've chosen yourself are kept
  await page.waitForFunction(function () { return !findButton.disabled; });
  await page.evaluate(function () {
    beforeDateInput.value = "2026-01-05";
    beforeDateInput.dispatchEvent(new Event("change"));
    afterDateInput.value = "2026-04-05";
    afterDateInput.dispatchEvent(new Event("change"));
  });
  const withDates = await clickMapAt(page, 24.42, 54.57);
  assert.deepEqual(withDates.dates, ["2026-01-05", "2026-04-05"]);

  // Draw area turns Click to analyse off
  await page.$eval("#draw-button", function (b) { b.click(); });
  assert.equal(await page.$eval("#click-mode-button", function (b) { return b.getAttribute("aria-pressed"); }), "false");
  assert.deepEqual(errors, []);
  await page.close();
});

test("the result tabs: one panel at a time, and the tab is kept in links", async function () {
  const { page, errors } = await openOfflinePage(site);
  assert.equal(await page.$eval("#results-step", function (e) { return e.hidden; }), true, "no tabs before an area is chosen");
  await page.evaluate(function () { setArea(L.latLngBounds([24.38, 54.54], [24.40, 54.56])); });
  for (const name of ["terrain", "place", "changes"]) {
    await page.$eval("#tab-" + name, function (b) { b.click(); });
    const state = await page.evaluate(function () {
      return ["changes", "terrain", "place"].map(function (n) {
        return [document.getElementById("tab-" + n).getAttribute("aria-selected"), document.getElementById("panel-" + n).hidden];
      });
    });
    for (const [k, other] of ["changes", "terrain", "place"].entries()) {
      assert.deepEqual(state[k], other === name ? ["true", false] : ["false", true], name + " tab: " + other);
    }
  }
  // The terrain words are explained on the page
  const words = await page.$$eval("#terrain-words dt", function (dts) { return dts.map(function (d) { return d.textContent; }); });
  assert.deepEqual(words, ["Elevation", "Slope", "Aspect", "Hillshade", "Low-lying", "Elevation profile"]);
  // Links remember the tab, and leave it out for Changes
  const links = await page.evaluate(function () {
    const box = L.latLngBounds([24.38, 54.54], [24.40, 54.56]);
    return [shareLink(box, "2026-07-03", "2026-10-01", "terrain"), shareLink(box, "2026-07-03", "2026-10-01", "changes"),
      readSharedSearch("?area=24.38,54.54,24.4,54.56&before=2026-07-03&after=2026-10-01&tab=place").tab,
      readSharedSearch("?area=24.38,54.54,24.4,54.56&before=2026-07-03&after=2026-10-01&tab=nonsense").tab];
  });
  assert.match(links[0], /&tab=terrain$/);
  assert.doesNotMatch(links[1], /tab=/);
  assert.equal(links[2], "place");
  assert.equal(links[3], "changes", "an unknown tab opens Changes");
  assert.deepEqual(errors, []);
  await page.close();
});

test("a shared link with tab=terrain opens on the Terrain tab", async function () {
  const { page } = await openOfflinePage(site, "?area=24.38120,54.54020,24.39920,54.56000&before=2026-07-03&after=2026-10-01&tab=terrain");
  const state = await page.evaluate(function () {
    return { tab: currentTab, terrainHidden: document.getElementById("panel-terrain").hidden, address: location.search };
  });
  assert.equal(state.tab, "terrain");
  assert.equal(state.terrainHidden, false);
  assert.match(state.address, /&tab=terrain$/);
  await page.close();
});
