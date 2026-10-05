// Tests for the landing page at the main address, and for old shared links
// (the main address with an area and dates) being forwarded to the tool at
// /app/. Satellite images, map pictures and place details are blocked, so these
// run in a few seconds.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { openSite } = require("./helpers.js");

let site;
before(async function () { site = await openSite(); });
after(async function () { await site.close(); });

const OLD_LINK = "?area=24.38120,54.54020,24.39920,54.56000&before=2026-07-03&after=2026-10-01";

// Opens an address in a new tab, with only the site and its code libraries
// allowed through. "width" and "height" set the window size (a phone, say).
async function openPage(address, width, height) {
  const page = await site.browser.newPage();
  await page.setViewport({ width: width || 1400, height: height || 900 });
  const errors = [];
  const missing = []; // the site's own files that weren't found
  page.on("pageerror", function (error) { errors.push(error.message); });
  page.on("response", function (response) {
    if (response.status() >= 400 && response.url().startsWith(site.home)) missing.push(response.url());
  });
  await page.setRequestInterception(true);
  page.on("request", function (request) {
    const host = new URL(request.url()).hostname;
    if (host === "127.0.0.1" || /unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/.test(host)) request.continue();
    else request.abort();
  });
  await page.goto(address, { waitUntil: "load" });
  return { page: page, errors: errors, missing: missing };
}

test("the landing page loads, with the name, tagline, launch button and pictures", async function () {
  const { page, errors, missing } = await openPage(site.home);
  const state = await page.evaluate(function () {
    return {
      address: location.href,
      title: document.title,
      name: document.querySelector("h1").textContent,
      tagline: document.querySelector(".tagline").textContent,
      launch: [...document.querySelectorAll("a")].filter(function (a) { return a.textContent.trim() === "Launch TerraShift"; })
        .map(function (a) { return a.href; }),
      headings: [...document.querySelectorAll("h2")].map(function (h) { return h.textContent; }),
      cards: [...document.querySelectorAll(".card h3")].map(function (h) { return h.textContent; })
    };
  });
  assert.equal(state.address, site.home, "no forwarding without a search in the link");
  assert.match(state.title, /TerraShift/);
  assert.equal(state.name, "TerraShift");
  assert.equal(state.tagline, "See how the land changes");
  assert.ok(state.launch.length >= 1, "there is a Launch TerraShift button");
  for (const href of state.launch) assert.equal(href, site.url, "Launch opens the tool at /app/");
  assert.deepEqual(state.headings, ["How it works", "What it can show", "Try an example", "What it can and can't do", "Responsible use"]);
  assert.deepEqual(state.cards, ["New buildings or bare ground", "Plants gained or lost", "Burned land", "Terrain"]);

  // Every picture loads (the lazy ones too, once scrolled to)
  await page.evaluate(function () {
    for (const image of document.images) image.loading = "eager";
  });
  await page.waitForFunction(function () {
    return [...document.images].every(function (image) { return image.complete; });
  });
  const broken = await page.$$eval("img", function (images) {
    return images.filter(function (image) { return image.naturalWidth === 0; }).map(function (image) { return image.src; });
  });
  assert.deepEqual(broken, []);
  assert.deepEqual(missing, []);
  assert.deepEqual(errors, []);
  await page.close();
});

test("an old shared link to the main address is forwarded to /app/ with the same search", async function () {
  for (const query of [OLD_LINK, OLD_LINK + "&tab=terrain"]) {
    const { page, errors } = await openPage(site.home + query);
    // The tool loads and opens the search from the link
    await page.waitForFunction(function () { return typeof openSharedLink === "function"; });
    const state = await page.evaluate(function () {
      return {
        area: document.getElementById("area-text").textContent,
        before: document.getElementById("before-date").value,
        after: document.getElementById("after-date").value,
        terrainTab: document.getElementById("tab-terrain").getAttribute("aria-selected")
      };
    });
    assert.equal(page.url(), site.url + query, "same address, now under /app/");
    assert.match(state.area, /centre 24\.39020, 54\.55010/);
    assert.equal(state.before, "2026-07-03");
    assert.equal(state.after, "2026-10-01");
    assert.equal(state.terrainTab, query.includes("tab=terrain") ? "true" : "false");
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("the old link is forwarded by index.html too, and the back button skips the forwarding page", async function () {
  const { page } = await openPage(site.home + "index.html" + OLD_LINK);
  await page.waitForFunction(function () { return typeof openSharedLink === "function"; });
  assert.equal(page.url(), site.url + OLD_LINK);
  // location.replace leaves no history entry for the landing page: only the
  // new tab's blank page and the tool
  assert.equal(await page.evaluate(function () { return history.length; }), 2);
  await page.close();
});

test("each example opens the tool with that example's area and dates", async function () {
  // The tool's own share links for its examples
  const tool = await openPage(site.url);
  await tool.page.waitForFunction(function () { return typeof EXAMPLES !== "undefined"; });
  const expected = await tool.page.evaluate(function () {
    return EXAMPLES.map(function (example) {
      const box = L.latLngBounds(
        [example.lat - 0.009, example.lng - 0.0099],
        [example.lat + 0.009, example.lng + 0.0099]
      );
      return { name: example.name, link: shareLink(box, example.before, example.after) };
    });
  });
  await tool.page.close();

  const { page } = await openPage(site.home);
  const examples = await page.$$eval("#examples a.example", function (links) {
    return links.map(function (a) { return { name: a.querySelector("strong").textContent, link: a.href }; });
  });
  assert.deepEqual(examples, expected, "the landing page's example links match the tool's examples");

  // Following one opens the tool and starts its search
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#examples a.example:nth-child(2)")]);
  await page.waitForFunction(function () { return typeof openSharedLink === "function"; });
  const state = await page.evaluate(function () {
    return {
      area: document.getElementById("area-text").textContent,
      status: document.getElementById("status-text").textContent
    };
  });
  assert.equal(page.url(), expected[1].link);
  assert.match(state.area, /centre 24\.49430, 54\.34500/);
  assert.match(state.status, /Searching|Sorry/);
  await page.close();
});

test("the before/after slider moves by drag and keyboard, and Show changes swaps the after picture", async function () {
  const { page } = await openPage(site.home);
  const position = function () {
    return page.$eval("#compare", function (c) { return c.style.getPropertyValue("--position"); });
  };
  assert.equal(await position(), "50%");

  // Drag to a quarter of the way across
  const box = await (await page.$("#compare")).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.equal(Math.round(parseFloat(await position())), 25);

  // The keyboard moves it too
  await page.focus("#compare-range");
  await page.keyboard.press("ArrowRight");
  assert.equal(Math.round(parseFloat(await position())), 26);

  await page.click("#compare-changes");
  const shown = await page.evaluate(function () {
    return { src: document.getElementById("compare-after").getAttribute("src"),
      pressed: document.getElementById("compare-changes").getAttribute("aria-pressed") };
  });
  assert.deepEqual(shown, { src: "docs/landing/hero-changes.jpg", pressed: "true" });
  await page.click("#compare-changes");
  assert.equal(await page.$eval("#compare-after", function (i) { return i.getAttribute("src"); }), "docs/landing/hero-after.jpg");
  await page.close();
});

test("the footer links to the code, README, VALIDATION.md, CREDITS.md and the latest release", async function () {
  const { page } = await openPage(site.home);
  const links = await page.$$eval(".footer-links a", function (links) { return links.map(function (a) { return a.href; }); });
  const repo = "https://github.com/kwetemasego-sego/terrashift";
  assert.deepEqual(links, [repo, repo + "#readme", repo + "/blob/main/VALIDATION.md", repo + "/blob/main/CREDITS.md", repo + "/releases/latest"]);
  const validation = await page.$eval(".limits-link a", function (a) { return a.href; });
  assert.equal(validation, repo + "/blob/main/VALIDATION.md");
  await page.close();
});

test("on a phone the page fits the screen, with no sideways scrolling", async function () {
  for (const [width, height] of [[390, 844], [320, 640]]) {
    const { page, errors } = await openPage(site.home, width, height);
    const state = await page.evaluate(function () {
      const launch = document.querySelector(".hero .button-large").getBoundingClientRect();
      const slider = document.getElementById("compare").getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        launchInside: launch.left >= 0 && launch.right <= innerWidth,
        sliderInside: slider.left >= 0 && slider.right <= innerWidth,
        navHidden: getComputedStyle(document.querySelector(".site-nav")).display === "none"
      };
    });
    assert.ok(state.pageWidth <= width, width + " px wide: the page is " + state.pageWidth + " px wide");
    assert.ok(state.launchInside, "the Launch button fits");
    assert.ok(state.sliderInside, "the slider fits");
    assert.ok(state.navHidden, "the section links are hidden to save room");
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("the tool links back to the landing page", async function () {
  const { page } = await openPage(site.url);
  const home = await page.$eval(".panel-title a", function (a) { return a.href; });
  assert.equal(home, site.home);
  await page.close();
});
