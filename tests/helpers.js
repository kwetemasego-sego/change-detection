// Shared helpers for the browser tests: a small web server for the site, and
// a headless Chrome (a browser without a window) to open it in.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = path.join(__dirname, "..");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".md": "text/markdown"
};

// Serves the project's files on a free port, like "python -m http.server"
async function startServer() {
  const server = http.createServer(function (request, response) {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    // A folder's address ("/" or "/app/") serves its index.html, like GitHub Pages
    const file = path.join(ROOT, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  return { server: server, home: "http://127.0.0.1:" + server.address().port + "/" };
}

// Starts the server and Chrome, and opens the tool (at /app/). Errors in the
// page's own code are collected in "pageErrors", so tests can check there were
// none. "home" is the landing page's address, "url" the tool's.
async function openSite() {
  const { server, home } = await startServer();
  const url = home + "app/";
  const browser = await puppeteer.launch({
    headless: true,
    protocolTimeout: 900000,
    // GitHub's test machines run as an administrator, which Chrome's sandbox doesn't allow
    args: process.env.CI ? ["--no-sandbox"] : [],
    defaultViewport: { width: 1400, height: 900 }
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", function (error) { pageErrors.push(error.message); });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
  async function close() {
    await browser.close();
    server.close();
  }
  return { page: page, pageErrors: pageErrors, close: close, home: home, url: url, browser: browser };
}

// Opens the site in a new tab with only the site and its code libraries
// allowed through: satellite images, elevation, map pictures and place details
// are all blocked, so a test is quick and doesn't use those free services.
// "query" is added to the address, e.g. "?area=...".
async function openOfflinePage(site, query) {
  const page = await site.browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on("pageerror", function (error) { errors.push(error.message); });
  await page.setRequestInterception(true);
  page.on("request", function (request) {
    const host = new URL(request.url()).hostname;
    if (host === "127.0.0.1" || /unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com/.test(host)) request.continue();
    else request.abort();
  });
  await page.goto(site.url + (query || ""), { waitUntil: "load" });
  return { page: page, errors: errors };
}

module.exports = { openSite, openOfflinePage };
