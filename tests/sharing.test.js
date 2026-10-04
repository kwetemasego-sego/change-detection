// Tests for finding and sharing: links with the area and dates, the place
// search, and the examples. They run in a few seconds: the place search gets
// made-up answers, and requests for satellite images, map pictures and place
// details are blocked, so these tests don't use any of those services.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openSite } = require("./helpers.js");

let site;
let nominatimRequests = []; // [time, web address] of every place search the page sent
before(async function () { site = await openSite(); });
after(async function () { await site.close(); });

// Made-up place search answers, in Nominatim's format
const FAKE_PLACES = {
  "masdar city": [
    { display_name: "Masdar City, Abu Dhabi, United Arab Emirates", boundingbox: ["24.418", "24.436", "54.605", "54.625"] },
    { display_name: "Masdar Institute, Abu Dhabi, United Arab Emirates", boundingbox: ["24.433", "24.435", "54.616", "54.618"] }
  ],
  "lulu island": [{ display_name: "Lulu Island, Abu Dhabi, United Arab Emirates", boundingbox: ["24.48", "24.51", "54.33", "54.36"] }],
  "nowhere at all": []
};

// Opens the site in a new tab, with only the site and its code libraries allowed
// through; place searches get the made-up answers above
async function openPage(query) {
  const page = await site.browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on("pageerror", function (error) { errors.push(error.message); });
  await page.setRequestInterception(true);
  page.on("request", function (request) {
    const url = new URL(request.url());
    if (url.hostname === "nominatim.openstreetmap.org") {
      nominatimRequests.push([Date.now(), request.url()]);
      const answer = FAKE_PLACES[(url.searchParams.get("q") || "").toLowerCase()] || [];
      request.respond({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(answer) });
    } else if (url.hostname === "127.0.0.1" || /unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/.test(url.hostname)) {
      request.continue();
    } else {
      request.abort(); // satellite images, map pictures, place details
    }
  });
  // Note when the page itself asks Nominatim (its own clock, so a busy computer can't blur the gaps)
  await page.evaluateOnNewDocument(function () {
    window.placeSearchTimes = [];
    const realFetch = window.fetch;
    window.fetch = function (url, options) {
      if (String(url).startsWith("https://nominatim.openstreetmap.org/")) window.placeSearchTimes.push(performance.now());
      return realFetch.call(this, url, options);
    };
  });
  await page.goto(site.url + (query || ""), { waitUntil: "load" });
  await page.waitForFunction(function () { return typeof openSharedLink === "function"; });
  return { page: page, errors: errors };
}

test("a link is made from the area and dates, and read back the same", async function () {
  const { page } = await openPage();
  const result = await page.evaluate(function () {
    const box = L.latLngBounds([24.3812, 54.5402], [24.3992, 54.56]);
    const link = shareLink(box, "2026-07-03", "2026-10-01");
    const read = readSharedSearch(new URL(link).search);
    return {
      query: new URL(link).search,
      edges: [read.box.getSouth(), read.box.getWest(), read.box.getNorth(), read.box.getEast()],
      before: read.before, after: read.after
    };
  });
  assert.equal(result.query, "?area=24.38120,54.54020,24.39920,54.56000&before=2026-07-03&after=2026-10-01");
  assert.deepEqual(result.edges, [24.3812, 54.5402, 24.3992, 54.56]);
  assert.equal(result.before, "2026-07-03");
  assert.equal(result.after, "2026-10-01");
  await page.close();
});

test("links that don't make sense are refused", async function () {
  const { page } = await openPage();
  const results = await page.evaluate(function () {
    return [
      "", // no search in the link: nothing to do
      "?area=24.4,54.5,24.3,54.6&before=2026-07-03&after=2026-10-01", // south is north of north
      "?area=24.3,54.5,24.4&before=2026-07-03&after=2026-10-01", // only 3 edges
      "?area=24.3,abc,24.4,54.6&before=2026-07-03&after=2026-10-01", // not a number
      "?area=24.3,54.5,24.4,54.6&before=2026-10-01&after=2026-07-03", // dates the wrong way round
      "?area=24.3,54.5,24.4,54.6&before=2026-07-03&after=2999-01-01", // after date in the future
      "?area=24.3,54.5,24.4,54.6&before=July&after=2026-10-01" // not a date
    ].map(function (query) {
      const read = readSharedSearch(query);
      return read === null ? "none" : read.error ? "error" : "ok";
    });
  });
  assert.deepEqual(results, ["none", "error", "error", "error", "error", "error", "error"]);
  await page.close();
});

test("opening a shared link shows the area and dates and starts the search", async function () {
  const query = "?area=24.38120,54.54020,24.39920,54.56000&before=2026-07-03&after=2026-10-01";
  const { page, errors } = await openPage(query);
  const state = await page.evaluate(function () {
    return {
      area: document.getElementById("area-text").textContent,
      before: document.getElementById("before-date").value,
      after: document.getElementById("after-date").value,
      status: document.getElementById("status-text").textContent,
      copyEnabled: !document.getElementById("copy-link-button").disabled,
      address: location.search
    };
  });
  assert.match(state.area, /centre 24\.39020, 54\.55010/);
  assert.equal(state.before, "2026-07-03");
  assert.equal(state.after, "2026-10-01");
  // The search started (here the satellite requests are blocked, so it then says sorry)
  assert.match(state.status, /Searching|Sorry/);
  assert.equal(state.copyEnabled, true);
  assert.equal(state.address, query);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a link with a bad area says so instead of searching", async function () {
  const { page } = await openPage("?area=1,2,3&before=2026-07-03&after=2026-10-01");
  const status = await page.$eval("#status-text", function (element) { return element.textContent; });
  assert.match(status, /The link's area isn't valid/);
  await page.close();
});

test("Copy link copies the current area and dates", async function () {
  const { page } = await openPage();
  await site.browser.defaultBrowserContext().overridePermissions(site.url.replace(/\/$/, ""), ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  assert.equal(await page.$eval("#copy-link-button", function (b) { return b.disabled; }), true, "disabled until there is an area");
  await page.evaluate(function () {
    setArea(L.latLngBounds([24.418, 54.605], [24.436, 54.625]));
    document.getElementById("before-date").value = "2026-01-05";
    document.getElementById("after-date").value = "2026-04-05";
  });
  await page.click("#copy-link-button");
  await page.waitForFunction(function () { return document.getElementById("copy-link-status").textContent !== ""; });
  const copied = await page.evaluate(function () { return navigator.clipboard.readText(); });
  assert.equal(copied, site.url + "?area=24.41800,54.60500,24.43600,54.62500&before=2026-01-05&after=2026-04-05");
  assert.match(await page.$eval("#copy-link-status", function (e) { return e.textContent; }), /Link copied/);

  // If the browser doesn't allow copying, the link is shown to copy by hand
  await page.evaluate(function () {
    navigator.clipboard.writeText = function () { return Promise.reject(new Error("not allowed")); };
  });
  await page.click("#copy-link-button");
  await page.waitForSelector("#copy-link-status input");
  const shown = await page.$eval("#copy-link-status input", function (input) { return input.value; });
  assert.equal(shown, copied);
  await page.close();
});

test("place search: only on Search, at most once a second, answers kept, credit shown", async function () {
  const { page } = await openPage();
  nominatimRequests = [];
  // Typing alone sends nothing
  await page.type("#place-input", "Masdar City", { delay: 30 });
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.equal(nominatimRequests.length, 0, "no search while typing");

  await page.click("#place-search-button");
  await page.waitForFunction(function () { return /Showing/.test(document.getElementById("place-search-status").textContent); });
  // Wait for the map to finish gliding to the place
  await page.waitForFunction(function () {
    const centre = map.getCenter();
    return Math.abs(centre.lat - 24.427) < 0.005 && Math.abs(centre.lng - 54.615) < 0.005;
  }, { timeout: 10000 });
  const found = await page.evaluate(function () {
    const centre = map.getCenter();
    return {
      status: document.getElementById("place-search-status").textContent,
      results: [...document.querySelectorAll("#place-results button")].map(function (b) { return b.textContent; }),
      lat: centre.lat, lng: centre.lng
    };
  });
  assert.equal(nominatimRequests.length, 1);
  assert.match(nominatimRequests[0][1], /format=jsonv2&limit=5&q=Masdar%20City/);
  assert.equal(found.status, "Showing Masdar City. Now press Draw area or Use visible area.");
  assert.equal(found.results.length, 2, "both matches listed");
  assert.ok(Math.abs(found.lat - 24.427) < 0.005 && Math.abs(found.lng - 54.615) < 0.005, "the map moved to Masdar City");

  // Clicking another match goes there
  await page.click("#place-results li:nth-child(2) button");
  assert.match(await page.$eval("#place-search-status", function (e) { return e.textContent; }), /Showing Masdar Institute/);

  // The same search again uses the kept answer
  await page.click("#place-search-button");
  await page.waitForFunction(function () { return !document.getElementById("place-search-button").disabled; });
  assert.equal(nominatimRequests.length, 1, "the answer was kept, not asked for again");

  // Two new searches straight after each other are at least 1 second apart
  await page.$eval("#place-input", function (input) { input.value = "Lulu Island"; });
  await page.click("#place-search-button");
  await page.waitForFunction(function () { return /Showing Lulu/.test(document.getElementById("place-search-status").textContent); });
  await page.$eval("#place-input", function (input) { input.value = "Nowhere at all"; });
  await page.click("#place-search-button");
  await page.waitForFunction(function () { return /No places found/.test(document.getElementById("place-search-status").textContent); });
  assert.equal(nominatimRequests.length, 3);
  const times = await page.evaluate(function () { return window.placeSearchTimes; });
  assert.equal(times.length, 3);
  assert.ok(times[2] - times[1] >= 990, "searches are at least a second apart, give or take clock rounding (" + Math.round(times[2] - times[1]) + " ms)");

  // The credit is on the page
  const credit = await page.$eval(".credit-line", function (e) { return e.textContent.replace(/\s+/g, " ").trim(); });
  assert.equal(credit, "Search by Nominatim, data © OpenStreetMap contributors");
  await page.close();
});

test("each example loads its area and dates and starts the search", async function () {
  const { page, errors } = await openPage();
  const names = await page.$$eval("#examples button", function (buttons) { return buttons.map(function (b) { return b.textContent; }); });
  assert.deepEqual(names, ["Khalifa City: white fill", "Lulu Island: earthworks", "Al Mushrif: seasonal greening"]);
  const centres = ["24.39020, 54.55010", "24.49430, 54.34500", "24.45600, 54.38600"];
  for (let i = 0; i < names.length; i++) {
    // Wait for the previous search to give up (the satellite requests are blocked)
    await page.waitForFunction(function () { return !document.getElementById("find-button").disabled; });
    await page.click("#examples button:nth-child(" + (i + 1) + ")");
    const state = await page.evaluate(function () {
      return {
        area: document.getElementById("area-text").textContent,
        dates: [document.getElementById("before-date").value, document.getElementById("after-date").value],
        status: document.getElementById("status-text").textContent,
        address: location.search
      };
    });
    assert.match(state.area, new RegExp("centre " + centres[i]), names[i]);
    assert.deepEqual(state.dates, ["2026-07-03", "2026-10-01"]);
    assert.match(state.status, /Searching|Sorry/);
    assert.match(state.address, /^\?area=.*&before=2026-07-03&after=2026-10-01$/, "the address can be shared");
  }
  assert.deepEqual(errors, []);
  await page.close();
});
