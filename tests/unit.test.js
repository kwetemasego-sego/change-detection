// Fast tests: open the site in headless Chrome and check its functions on
// made-up data, so they don't need any satellite images. They take a few seconds.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openSite } = require("./helpers.js");

let site;
before(async function () { site = await openSite(); });
after(async function () { await site.close(); });

// Runs a function inside the page, where all of main.js's functions exist
function inPage(fn, ...args) {
  return site.page.evaluate(fn, ...args);
}

test("the page loads without errors and starts with no results", async function () {
  const state = await inPage(function () {
    return {
      title: document.title,
      changesHidden: document.getElementById("change-section").hidden,
      seasonHidden: document.getElementById("season-note").hidden,
      status: document.getElementById("status-text").textContent
    };
  });
  assert.equal(state.title, "Satellite Change Viewer");
  assert.equal(state.changesHidden, true);
  assert.equal(state.seasonHidden, true);
  assert.equal(state.status, "Start by choosing an area.");
  assert.deepEqual(site.pageErrors, []);
});

test("areas are written in m² or hectares", async function () {
  const texts = await inPage(function () {
    return [formatArea(800), formatArea(23000), formatArea(4040000)];
  });
  assert.deepEqual(texts, ["800 m²", "2.3 ha", "404 ha"]);
});

test("seasons are worked out for both halves of the Earth", async function () {
  const seasons = await inPage(function () {
    return [
      seasonOf("2026-07-03", 24), seasonOf("2026-10-01", 24), seasonOf("2026-12-15", 24),
      seasonOf("2026-01-10", -33), seasonOf("2026-04-20", -33)
    ];
  });
  assert.deepEqual(seasons, ["summer", "autumn", "winter", "summer", "autumn"]);
});

test("a lone changed square is removed, a patch is kept", async function () {
  const kept = await inPage(function () {
    const columns = 10, rows = 10;
    const kinds = new Uint8Array(columns * rows);
    kinds[1 * columns + 1] = PLANTS_GAINED; // on its own
    for (let r = 5; r < 8; r++) for (let c = 5; c < 8; c++) kinds[r * columns + c] = PLANTS_GAINED; // a 3 x 3 patch
    const result = removeLoneSquares(kinds, columns, rows);
    return { lone: result[1 * columns + 1], patch: result.filter(function (k) { return k === PLANTS_GAINED; }).length };
  });
  assert.equal(kept.lone, 0);
  assert.equal(kept.patch, 9);
});

test("bright patches smaller than 25 squares are dropped", async function () {
  const result = await inPage(function () {
    const columns = 20, rows = 20;
    const kinds = new Uint8Array(columns * rows);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) kinds[r * columns + c] = BRIGHT_SURFACE; // 24 squares
    for (let r = 10; r < 15; r++) for (let c = 10; c < 15; c++) kinds[r * columns + c] = BRIGHT_SURFACE; // 25 squares
    const keptSquares = keepBigPatches(kinds, columns, rows, BRIGHT_SURFACE, BRIGHT_MIN_SQUARES);
    return { keptSquares: keptSquares, small: kinds[0], big: kinds[12 * columns + 12] };
  });
  assert.equal(result.keptSquares, 25);
  assert.equal(result.small, 0);
  assert.equal(result.big, await inPage(function () { return BRIGHT_SURFACE; }));
});

// A 60 x 60 square area of sand, with blocks of 6 x 6 squares that change in
// different ways. Returns how many squares of each block got each kind of change.
test("change detection on made-up blocks", async function () {
  const blocks = await inPage(function () {
    const columns = 60, rows = 60, count = columns * rows;
    const SAND = { visible: 0.30, swir: 0.45, swir2: 0.40, nir: 0.42, ndvi: 0.06, ndbi: 0.03, nbr: 0.02 };
    // [name, first column, first row, size, before values, after values]
    const BLOCKS = [
      ["white fill", 5, 5, 6, {}, { visible: 0.60, swir: 0.50, ndbi: -0.05 }],
      ["small white fill", 30, 5, 4, {}, { visible: 0.60, swir: 0.50, ndbi: -0.05 }],
      ["solar panels cleaned", 5, 30, 6,
        { visible: 0.15, swir: 0.40, nir: 0.30, ndbi: 0.14 }, { visible: 0.11, swir: 0.34, nir: 0.22, ndbi: 0.26 }],
      ["dark roof on sand", 30, 30, 6, {}, { visible: 0.18, swir: 0.40, nir: 0.27, ndbi: 0.20 }],
      ["plants gained", 45, 45, 6, { ndvi: 0.10 }, { ndvi: 0.50 }],
      ["wet ground dried", 45, 5, 6, { visible: 0.15, swir: 0.10 }, { visible: 0.50, swir: 0.30 }]
    ];
    function blockAt(column, row) {
      return BLOCKS.find(function ([, c, r, size]) {
        return column >= c && column < c + size && row >= r && row < r + size;
      });
    }
    function makeScores(which) { // which = 4 (before values) or 5 (after values)
      const scores = { usable: new Uint8Array(count).fill(1), water: new Uint8Array(count) };
      for (const name of Object.keys(SAND)) scores[name] = new Float32Array(count);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const block = blockAt(column, row);
          const values = Object.assign({}, SAND, block ? block[which] : {});
          for (const name of Object.keys(SAND)) scores[name][row * columns + column] = values[name];
        }
      }
      return scores;
    }
    const result = compareScores(makeScores(4), makeScores(5), { columns: columns, rows: rows });
    const found = { brightSquares: result.brightSquares };
    for (const [name, c0, r0, size] of BLOCKS) {
      const kinds = {};
      for (let row = r0; row < r0 + size; row++) {
        for (let column = c0; column < c0 + size; column++) {
          const name2 = CHANGE_NAMES[result.kinds[row * columns + column]] || "no change";
          kinds[name2] = (kinds[name2] || 0) + 1;
        }
      }
      found[name] = kinds;
    }
    return found;
  });
  assert.deepEqual(blocks["white fill"], { "New buildings or bare ground": 36 }, "white fill is a bright new surface");
  assert.equal(blocks.brightSquares, 36, "only the big white patch counts as bright new surface");
  assert.deepEqual(blocks["small white fill"], { "no change": 16 }, "a bright patch under 2,500 m² is dropped");
  assert.deepEqual(blocks["solar panels cleaned"], { "no change": 36 }, "dark panels that only got darker aren't new buildings");
  assert.deepEqual(blocks["dark roof on sand"], { "New buildings or bare ground": 36 }, "a new dark roof on bright sand still counts");
  assert.deepEqual(blocks["plants gained"], { "Plants gained": 36 });
  assert.deepEqual(blocks["wet ground dried"], { "no change": 36 }, "wet ground drying out isn't a bright new surface");
});

test("plant changes missing a year apart count as probably seasonal", async function () {
  const seasonal = await inPage(function () {
    const kinds = new Uint8Array([PLANTS_GAINED, PLANTS_GAINED, PLANTS_LOST, PLANTS_GAINED, NEW_BUILT_OR_BARE]);
    const yearApart = new Uint8Array([PLANTS_GAINED, NO_CHANGE, NO_CHANGE, SKIPPED, NO_CHANGE]);
    return probablySeasonal(kinds, yearApart);
  });
  // 4 squares of plant change: 1 also a year apart, 2 not (seasonal), 1 hidden by cloud a year apart
  assert.deepEqual(seasonal, { plantSquares: 4, seasonalSquares: 2 });
});

test("the summary adds up", async function () {
  const numbers = await inPage(function () {
    const counts = { [NO_CHANGE]: 9000, [SKIPPED]: 1000, [PLANTS_GAINED]: 0, [PLANTS_LOST]: 0, [NEW_BUILT_OR_BARE]: 0, [BURNED]: 0 };
    counts[PLANTS_GAINED] = 90;
    counts[NEW_BUILT_OR_BARE] = 210;
    counts[NO_CHANGE] = 9000 - 300;
    const n = summaryNumbers(counts, 10000);
    return { gained: n[PLANTS_GAINED], built: n[NEW_BUILT_OR_BARE], total: n.totalSentence, skipped: n.skipped };
  });
  assert.deepEqual(numbers.gained, { size: "9,000 m²", percent: "1.0%" });
  assert.deepEqual(numbers.built, { size: "2.1 ha", percent: "2.3%" });
  assert.equal(numbers.total, "Changed: 3.0 ha (3.3%) of the 90.0 ha (9,000 squares) that could be compared.");
  assert.equal(numbers.skipped, "10.0 ha (10.0% of the area)");
});
