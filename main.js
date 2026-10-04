// =====================================================
// SETTINGS: change these to tweak the website
// =====================================================

// Where the map starts: Abu Dhabi, UAE. Latitude first, then longitude.
const START_LAT = 24.4691;
const START_LNG = 54.3412;
const START_ZOOM = 13;

// Default dates: "after" is today, "before" is this many days earlier (about 3 months)
const DEFAULT_GAP_DAYS = 90;

// When looking for an image near a date, search this many days before and after it
const SEARCH_WINDOW_DAYS = 20;

// How much one extra day away from the chosen date counts against an image,
// compared with 1% more cloud. 0.5 means "1 day further away = 0.5% cloudier".
const DAY_PENALTY = 0.5;

// How many of the least cloudy images near each date to check closely, by
// looking at the cloud over the chosen area itself (more = slower but better)
const IMAGES_TO_CHECK = 6;

// How much it counts against a before/after pair if the two photos were taken
// from different satellite paths (see choosePair). 20 = "as bad as 20% more cloud".
const DIFFERENT_VIEW_PENALTY = 20;

// --- Change detection ---
// A pixel only counts as changed if the difference is at least this big.
// NDVI and NDBI are scores from -1 to +1 (see section 4b for what they mean).
// Smaller differences usually come from haze, the sun's angle or the season,
// not from real changes on the ground.
const NDVI_THRESHOLD = 0.15; // plant greenness must rise or fall by at least 0.15
const PLANTS_NDVI = 0.3; // ...and the square must look like plants (NDVI 0.3+) on the greener date
const NDBI_THRESHOLD = 0.1; // built-up score must rise by at least 0.10
// Two things can raise the built-up score without anything being built:
const WET_SWIR = 0.15; // ground this dark in short-wave infrared before was wet (tidal mud), so drying isn't counted
const SHADOW_DARKENING = 0.6; // ground that became this much darker (less than 60%) is usually in a new, longer shadow
const CHANGE_PIXEL_METRES = 10; // size of each compared square (Sentinel-2's sharpest bands are 10 m)
const MAX_CHANGE_AREA_KM = 10; // larger areas would download too much, so changes aren't calculated

// --- Showing the photos ---
// Black always means "no light reflected". How bright counts as white is chosen
// from the pixels inside your area: the brightest 2% are shown as white, and
// everything darker is spread evenly below. That way bright desert and darker
// city both show detail.
const DISPLAY_BRIGHT_PERCENT = 98;
// Used if the automatic white point can't be worked out (reflectance 0.4)
const DEFAULT_DISPLAY_WHITE = 0.4;
// At zoom 16 a map tile pixel is about 2 m, already finer than Sentinel-2's 10 m
// pixels. Closer than this the tiles are only enlarged, so we show a note.
const SENTINEL_SHARPEST_ZOOM = 16;

// --- Time series (section 4e) ---
const SERIES_STEP_DAYS = 14; // look for one clear image about every 2 weeks
const SERIES_MAX_IMAGES = 60; // for long date ranges the step grows, so there are at most this many
const SERIES_MAX_CLOUD = 10; // an image counts as clear if at most 10% of the area is hidden
const SERIES_TRIES = 3; // images to check in each 2-week period before giving up on it
const SERIES_SAMPLE_POINTS = 100; // sample the area at up to 100 x 100 points, to keep downloads small
const SERIES_PARALLEL = 3; // how many periods to check at the same time

// Microsoft Planetary Computer: a free catalogue of Sentinel-2 images, a
// service that turns any image into map tiles, and the image files themselves.
// None of these need an API key. Reading the files needs a free "token"
// (a temporary pass) that anyone can get from TOKEN_URL.
const STAC_SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const TILE_URL = "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png";
const TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a";
// The same service also cuts out a small piece of an image ("bbox" = the area's edges)
const CUTOUT_URL = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox/";

// =====================================================
// 1. The map, with satellite photos and labels
// =====================================================

const map = L.map("map", { maxZoom: 19 }).setView([START_LAT, START_LNG], START_ZOOM);

// "Panes" are layers of the map stacked on top of each other, like sheets of
// glass. We make our own, so the Sentinel-2 images sit above the normal map
// but below the street and place names. Higher zIndex = closer to the top.
map.createPane("beforePane").style.zIndex = 250;
map.createPane("afterPane").style.zIndex = 260;
map.createPane("changesPane").style.zIndex = 300; // the coloured change layer
map.createPane("seriesPane").style.zIndex = 320; // a time-series image covers everything below it
map.createPane("labelsPane").style.zIndex = 350;
map.getPane("labelsPane").style.pointerEvents = "none"; // clicks go through the labels

// All map pictures ("tiles") come from Esri's free servers: no API key needed,
// as long as we show the credits (the "attribution") in the corner.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";

// --- Satellite view: photos, with see-through label layers on top ---
const satellitePhotos = L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
});
// Roads and street names
const streetLabels = L.tileLayer(ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  pane: "labelsPane",
  attribution: "Labels &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
});
// City and neighbourhood names
const placeLabels = L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  pane: "labelsPane"
});
// A layer group lets us show or hide all three together
const satelliteView = L.layerGroup([satellitePhotos, streetLabels, placeLabels]);

// --- Street map view: a normal drawn map ---
const streetMapView = L.tileLayer(ESRI + "World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Map &copy; Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors"
});

satelliteView.addTo(map); // start with the satellite view

// The "Street map / Satellite" button swaps one view for the other
const mapViewButton = document.getElementById("map-view-button");
let showingSatellite = true;

mapViewButton.addEventListener("click", function () {
  if (showingSatellite) {
    map.removeLayer(satelliteView);
    streetMapView.addTo(map);
    mapViewButton.textContent = "Show satellite";
  } else {
    map.removeLayer(streetMapView);
    satelliteView.addTo(map);
    mapViewButton.textContent = "Show street map";
  }
  showingSatellite = !showingSatellite;
});

// --- Latitude and longitude under the mouse pointer ---
const pointerText = document.getElementById("pointer-position");

map.on("mousemove", function (event) {
  pointerText.textContent = event.latlng.lat.toFixed(5) + ", " + event.latlng.lng.toFixed(5);
});

// =====================================================
// 2. Choosing an area
// =====================================================
// Two ways: "Draw area" (drag a box on the map with the mouse), or
// "Use visible area" (whatever is on screen right now, which also works on phones).

const drawButton = document.getElementById("draw-button");
const useViewButton = document.getElementById("use-view-button");
const areaText = document.getElementById("area-text");
const statusText = document.getElementById("status-text");

let chosenArea = null; // the chosen area as a Leaflet "LatLngBounds" box (null = none yet)

// The box drawn on the map to show the chosen area
const areaBox = L.rectangle([[0, 0], [0, 0]], {
  color: "#ffe14d",
  weight: 2,
  fill: false,
  interactive: false
});

let drawing = false; // true after "Draw area" is pressed, until the box is finished
let drawStart = null; // the corner where the mouse button went down

drawButton.addEventListener("click", function () {
  drawing = true;
  map.dragging.disable(); // so dragging draws a box instead of moving the map
  map.getContainer().style.cursor = "crosshair";
  statusText.textContent = "Press and drag on the map to draw your area.";
});

map.on("mousedown", function (event) {
  if (!drawing) return;
  drawStart = event.latlng;
  areaBox.setBounds(L.latLngBounds(drawStart, drawStart)).addTo(map);
});

map.on("mousemove", function (event) {
  if (drawStart) {
    areaBox.setBounds(L.latLngBounds(drawStart, event.latlng)); // stretch the box as the mouse moves
  }
});

map.on("mouseup", function (event) {
  if (!drawStart) return;
  const box = L.latLngBounds(drawStart, event.latlng);
  drawing = false;
  drawStart = null;
  map.dragging.enable();
  map.getContainer().style.cursor = "";
  setArea(box);
});

useViewButton.addEventListener("click", function () {
  setArea(map.getBounds());
});

// Remembers the chosen area, shows its size, and looks up details for its centre
function setArea(box) {
  chosenArea = box;
  areaBox.setBounds(box).addTo(map);
  clearComparison(); // images for an old area no longer apply

  const centre = box.getCenter();
  const widthKm = map.distance(box.getSouthWest(), box.getSouthEast()) / 1000;
  const heightKm = map.distance(box.getSouthWest(), box.getNorthWest()) / 1000;
  areaText.textContent =
    widthKm.toFixed(1) + " km × " + heightKm.toFixed(1) + " km, centre " +
    centre.lat.toFixed(5) + ", " + centre.lng.toFixed(5);
  statusText.textContent = "Now choose two dates and press Find images.";

  lookUpPlace(centre); // fill in the place details panel (section 6)
}

// =====================================================
// 3. Choosing dates
// =====================================================

const beforeDateInput = document.getElementById("before-date");
const afterDateInput = document.getElementById("after-date");

// Turns a JavaScript date into the "2026-10-04" text that date boxes use
function toDateText(date) {
  return date.toISOString().slice(0, 10);
}

const today = new Date();
afterDateInput.value = toDateText(today);
beforeDateInput.value = toDateText(new Date(today.getTime() - DEFAULT_GAP_DAYS * 24 * 60 * 60 * 1000));
afterDateInput.max = toDateText(today); // no images from the future!
beforeDateInput.max = toDateText(today);

// =====================================================
// 4. Finding the clearest Sentinel-2 image near a date
// =====================================================
// Sentinel-2 is a group of European satellites that photograph the whole
// Earth every few days. Each photo ("item") covers a square about 110 km
// across. We ask the Planetary Computer catalogue for every photo of our area
// taken within SEARCH_WINDOW_DAYS of the date, then choose the clearest one
// by looking at the clouds over our area only (not the whole 110 km photo).

const ONE_DAY = 24 * 60 * 60 * 1000; // in milliseconds

// Sentinel-2's "scene classification" band (SCL) labels every 20 m pixel with
// what the satellite thinks is there. We skip pixels with these labels,
// because they don't show the ground clearly:
//   0 = no data, 1 = faulty pixel, 3 = cloud shadow,
//   8 = cloud (medium), 9 = cloud (high), 10 = thin cirrus cloud
const SKIP_CLASSES = [0, 1, 3, 8, 9, 10];
const WATER_CLASS = 6; // SCL also marks water

// Gets the free token (temporary pass) needed to read Planetary Computer's image files
async function getToken() {
  const data = await fetchJson(TOKEN_URL);
  return data.token;
}

// Finds the photos near a date that cover the whole area, and checks the
// clouds over the area for the most promising few
async function findClearImages(area, dateText, token) {
  const date = new Date(dateText + "T12:00:00Z");
  const from = new Date(date.getTime() - SEARCH_WINDOW_DAYS * ONE_DAY);
  const to = new Date(Math.min(date.getTime() + SEARCH_WINDOW_DAYS * ONE_DAY, Date.now()));

  // The catalogue search uses the STAC standard: we describe what we want in the web address
  const url =
    STAC_SEARCH_URL +
    "?collections=sentinel-2-l2a" +
    "&bbox=" + [area.getWest(), area.getSouth(), area.getEast(), area.getNorth()].join(",") +
    "&datetime=" + from.toISOString() + "/" + to.toISOString() +
    "&limit=100";
  const data = await fetchJson(url);

  // Keep only photos that cover the WHOLE area (some only cover part of it)
  const covering = data.features.filter(function (item) {
    return coversArea(item.geometry, area);
  });
  if (covering.length === 0) return [];

  // First, a quick sort using the cloud cover of the whole photo,
  // plus a little for each day away from the chosen date
  function daysAway(item) {
    return Math.abs(new Date(item.properties.datetime) - date) / ONE_DAY;
  }
  covering.sort(function (a, b) {
    return (a.properties["eo:cloud_cover"] + daysAway(a) * DAY_PENALTY) -
           (b.properties["eo:cloud_cover"] + daysAway(b) * DAY_PENALTY);
  });

  // Then look closely at the best few: how cloudy is it over OUR area?
  // (We check them all at the same time.)
  const grid = makeGrid(area, 20); // 20 m squares, the size of SCL's pixels
  const candidates = covering.slice(0, IMAGES_TO_CHECK);
  const cloudPercents = await Promise.all(
    candidates.map(function (item) {
      return areaCloudPercent(item, grid, token).catch(function () {
        return null; // couldn't read this one: leave it out
      });
    })
  );

  // The score: cloud over the area (%), plus a little for each day away
  const checked = [];
  for (let i = 0; i < candidates.length; i++) {
    if (cloudPercents[i] === null) continue;
    checked.push({
      item: candidates[i],
      areaCloud: cloudPercents[i],
      score: cloudPercents[i] + daysAway(candidates[i]) * DAY_PENALTY
    });
  }
  return checked; // a list of { item, areaCloud, score } (empty if none could be checked)
}

// Picks the best before photo and after photo TOGETHER.
// Photos taken from the same satellite path ("relative orbit") and stored in the
// same 110 km tile see the ground from the same angle, so buildings lean the same
// way and their pixels line up. Photos from different paths can make a city look
// changed when it isn't, so a mismatched pair gets a big penalty.
function choosePair(beforeList, afterList) {
  function sameView(a, b) {
    return a.item.properties["sat:relative_orbit"] === b.item.properties["sat:relative_orbit"] &&
           a.item.properties["s2:mgrs_tile"] === b.item.properties["s2:mgrs_tile"];
  }
  let best = null;
  for (const before of beforeList) {
    for (const after of afterList) {
      const score = before.score + after.score + (sameView(before, after) ? 0 : DIFFERENT_VIEW_PENALTY);
      if (!best || score < best.score) {
        best = { before: before, after: after, sameView: sameView(before, after), score: score };
      }
    }
  }
  return best; // null if either list is empty
}

// What percentage of the area is hidden by cloud, cloud shadow or missing data?
async function areaCloudPercent(item, grid, token) {
  const scl = await readBandOnGrid(item, "SCL", token, projectGrid(grid, item));
  return percentHidden(scl);
}

// The percentage of scene-classification values that are cloud, shadow or missing
function percentHidden(scl) {
  let skipped = 0;
  for (let i = 0; i < scl.length; i++) {
    if (isNaN(scl[i]) || SKIP_CLASSES.includes(scl[i])) skipped++;
  }
  return (100 * skipped) / scl.length;
}

// Does a photo's outline contain all four corners of our area?
// The outline ("geometry") is a GeoJSON Polygon or MultiPolygon, as [longitude, latitude] points.
function coversArea(geometry, area) {
  const outlines =
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map(function (polygon) { return polygon[0]; });
  const corners = [area.getSouthWest(), area.getSouthEast(), area.getNorthEast(), area.getNorthWest()];

  return corners.every(function (corner) {
    return outlines.some(function (outline) {
      return insideOutline(corner, outline);
    });
  });
}

// Is a point inside an outline? This is the classic "ray casting" test:
// imagine a line going right from the point, and count how many edges it
// crosses. An odd number means the point is inside.
function insideOutline(point, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i++) {
    const [lngA, latA] = outline[i];
    const [lngB, latB] = outline[j];
    if (latA > point.lat !== latB > point.lat &&
        point.lng < ((lngB - lngA) * (point.lat - latA)) / (latB - latA) + lngA) {
      inside = !inside;
    }
  }
  return inside;
}

// =====================================================
// 4a. Reading image bands with geotiff.js
// =====================================================
// A Sentinel-2 photo is stored as several files, one per "band" (colour of
// light). We use five of them:
//   B04 = red light (10 m pixels)
//   B08 = near-infrared, invisible light that plants reflect strongly (10 m pixels)
//   B8A = near-infrared again, in a narrower range and with 20 m pixels
//   B11 = short-wave infrared, reflected strongly by bare ground and buildings (20 m pixels)
//   SCL = the scene classification described above (20 m pixels)
// The files are "Cloud-Optimized GeoTIFFs": geotiff.js can download just the
// small block of pixels we need, instead of the whole 200 MB file.

// The grid: points spread evenly over the area, one per square of "metres" size.
// Points go row by row, from the top-left (north-west) corner.
function makeGrid(area, metres) {
  const widthMetres = map.distance(area.getSouthWest(), area.getSouthEast());
  const heightMetres = map.distance(area.getSouthWest(), area.getNorthWest());
  const columns = Math.max(1, Math.round(widthMetres / metres));
  const rows = Math.max(1, Math.round(heightMetres / metres));
  const lats = new Float64Array(columns * rows);
  const lngs = new Float64Array(columns * rows);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      // the centre of each square
      lats[i] = area.getNorth() - ((row + 0.5) * (area.getNorth() - area.getSouth())) / rows;
      lngs[i] = area.getWest() + ((column + 0.5) * (area.getEast() - area.getWest())) / columns;
    }
  }
  return { columns: columns, rows: rows, lats: lats, lngs: lngs, metres: metres };
}

// Sentinel-2 files don't use latitude and longitude. They use a flat map grid
// called UTM, measured in metres, which is different in each 6° wide "zone"
// of the Earth. Abu Dhabi sits right on the edge between zones 39 and 40, so
// the before and after photos may even use different zones!
// proj4 converts every grid point into the photo's own UTM coordinates.
function projectGrid(grid, item) {
  const epsg = item.properties["proj:epsg"]; // e.g. 32640 = UTM zone 40, northern half of the Earth
  const zone = epsg % 100;
  const south = epsg >= 32700 ? " +south" : "";
  const toUtm = proj4("WGS84", "+proj=utm +zone=" + zone + south + " +datum=WGS84 +units=m +no_defs");

  const xs = new Float64Array(grid.lats.length);
  const ys = new Float64Array(grid.lats.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < grid.lats.length; i++) {
    const [x, y] = toUtm.forward([grid.lngs[i], grid.lats[i]]);
    xs[i] = x;
    ys[i] = y;
    // keep track of the smallest and largest, to know which block of pixels to download
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { xs: xs, ys: ys, minX: minX, maxX: maxX, minY: minY, maxY: maxY, metres: grid.metres };
}

// Reads one band of a photo, and returns its value at every grid point
// (in the same order as the grid). NaN = no value there.
// The image server sometimes drops a connection when many files are read at
// once, so if a read fails we wait a moment and try again (up to 3 times).
async function readBandOnGrid(item, bandName, token, projected) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readBandOnGridOnce(item, bandName, token, projected);
    } catch (error) {
      if (attempt >= 3) throw error; // give up after the third try
      await new Promise(function (resolve) {
        setTimeout(resolve, 1000 * attempt); // wait 1 second, then 2 seconds
      });
    }
  }
}

async function readBandOnGridOnce(item, bandName, token, projected) {
  const tiff = await GeoTIFF.fromUrl(item.assets[bandName].href + "?" + token);
  const fullImage = await tiff.getImage();
  const [originX, originY] = fullImage.getOrigin(); // UTM position of the file's top-left corner
  const [fullPixelWidth, fullPixelHeight] = fullImage.getResolution(); // e.g. 10 and -10 (rows go south)

  // Each file also holds smaller copies of the photo ("overviews"), each half
  // the size of the one before. If our grid squares are much bigger than the
  // pixels, we use the smallest copy that is still detailed enough: far less to download.
  let image = fullImage;
  let shrink = 1; // how many times smaller the chosen copy is
  if (projected.metres >= 2 * fullPixelWidth) {
    const copies = await tiff.getImageCount();
    for (let i = 1; i < copies; i++) {
      const smaller = await tiff.getImage(i);
      const factor = fullImage.getWidth() / smaller.getWidth();
      if (fullPixelWidth * factor <= projected.metres) {
        image = smaller;
        shrink = factor;
      }
    }
  }
  const pixelWidth = fullPixelWidth * shrink;
  const pixelHeight = fullPixelHeight * shrink;

  // Which block of pixels covers all our grid points? (plus 1 pixel spare on each side)
  const left = Math.max(0, Math.floor((projected.minX - originX) / pixelWidth) - 1);
  const right = Math.min(image.getWidth(), Math.ceil((projected.maxX - originX) / pixelWidth) + 1);
  const top = Math.max(0, Math.floor((projected.maxY - originY) / pixelHeight) - 1);
  const bottom = Math.min(image.getHeight(), Math.ceil((projected.minY - originY) / pixelHeight) + 1);

  // Download just that block
  const [pixels] = await image.readRasters({ window: [left, top, right, bottom] });
  const blockWidth = right - left;
  const blockHeight = bottom - top;

  // Look up the pixel under each grid point
  const values = new Float32Array(projected.xs.length);
  for (let i = 0; i < values.length; i++) {
    const column = Math.floor((projected.xs[i] - originX) / pixelWidth) - left;
    const row = Math.floor((projected.ys[i] - originY) / pixelHeight) - top;
    const inside = column >= 0 && column < blockWidth && row >= 0 && row < blockHeight;
    values[i] = inside ? pixels[row * blockWidth + column] : NaN;
  }
  return values;
}

// =====================================================
// 4b. Change detection
// =====================================================
// For every 10 m square we work out two scores, for each date:
//   NDVI ("plant greenness") = (near-infrared - red) / (near-infrared + red)
//     Plants reflect lots of near-infrared, so: about 0.5 or more = lush plants,
//     about 0.2 = sparse plants, near 0 or below = sand, concrete or water.
//   NDBI ("built-up score") = (short-wave infrared - near-infrared) / (short-wave infrared + near-infrared)
//     Bare ground, concrete and roofs reflect lots of short-wave infrared,
//     so this score goes up when land is cleared, dug up or built on.
//     It uses B8A and B11, which both have 20 m pixels. Mixing a sharp 10 m band
//     with a blurrier 20 m band would make false changes along every shadow edge.
// Then we compare the scores between the two dates.

// The kinds of change, and the colour each is drawn in (red, green, blue, opacity 0-255)
const NO_CHANGE = 0;
const PLANTS_GAINED = 1;
const PLANTS_LOST = 2;
const NEW_BUILT_OR_BARE = 3;
const SKIPPED = 4;
const CHANGE_COLOURS = {
  [PLANTS_GAINED]: [46, 204, 64, 220], // green
  [PLANTS_LOST]: [255, 65, 54, 220], // red
  [NEW_BUILT_OR_BARE]: [0, 116, 217, 220], // blue
  [SKIPPED]: [150, 150, 150, 110] // see-through grey
};

// The files store light as whole numbers: reflectance x 10000. Since 2022
// (processing version 04.00 and later) a 1000 has also been added to every value,
// so it must be taken off again before working with the numbers.
function storedOffset(item) {
  return Number(item.properties["s2:processing_baseline"]) >= 4 ? 1000 : 0;
}

// Reads the five bands of one photo and works out NDVI, NDBI and which squares to skip
async function readScores(item, grid, token) {
  const projected = projectGrid(grid, item);
  const bands = await Promise.all(
    SCORE_BANDS.map(function (band) {
      return readBandOnGrid(item, band, token, projected);
    })
  );
  return scoresFromBands(item, bands);
}

// The bands readScores needs, in this order
const SCORE_BANDS = ["B04", "B08", "B8A", "B11", "SCL"];

// Works out the scores from the five bands' values (one value per grid square each)
function scoresFromBands(item, [red, nir, nir20, swir, scl]) {
  const offset = storedOffset(item);
  function reflectance(value) {
    return Math.max(0, (value - offset) / 10000);
  }
  // A score like NDVI, safe from dividing by zero
  function normalisedDifference(a, b) {
    return a + b > 0 ? (a - b) / (a + b) : 0;
  }

  const count = red.length;
  const ndvi = new Float32Array(count);
  const ndbi = new Float32Array(count);
  const swirBrightness = new Float32Array(count); // short-wave infrared reflectance, 0 to 1
  const usable = new Uint8Array(count); // 1 = clear view of the ground, 0 = skip
  const water = new Uint8Array(count); // 1 = SCL says water

  for (let i = 0; i < count; i++) {
    const clear = !isNaN(scl[i]) && !SKIP_CLASSES.includes(scl[i]) && red[i] > 0 && nir[i] > 0;
    usable[i] = clear ? 1 : 0;
    water[i] = scl[i] === WATER_CLASS ? 1 : 0;
    const r = reflectance(red[i]);
    const n = reflectance(nir[i]);
    const n20 = reflectance(nir20[i]);
    const s = reflectance(swir[i]);
    ndvi[i] = normalisedDifference(n, r);
    ndbi[i] = normalisedDifference(s, n20);
    swirBrightness[i] = s;
  }
  return { ndvi: ndvi, ndbi: ndbi, swir: swirBrightness, usable: usable, water: water };
}

// Compares before and after, square by square. Returns the kind of change for
// each square, plus how many squares there are of each kind.
function compareScores(before, after, grid) {
  let kinds = new Uint8Array(before.ndvi.length);

  for (let i = 0; i < kinds.length; i++) {
    let kind = NO_CHANGE;
    if (!before.usable[i] || !after.usable[i]) {
      kind = SKIPPED; // cloud, shadow or missing data in either photo
    } else if (before.water[i] || after.water[i]) {
      // Water or shoreline on either date: tides, waves and wet mud make these
      // look different from day to day even when nothing was built, so we leave them out.
      kind = NO_CHANGE;
    } else {
      const ndviChange = after.ndvi[i] - before.ndvi[i];
      const ndbiChange = after.ndbi[i] - before.ndbi[i];
      if (ndviChange >= NDVI_THRESHOLD && after.ndvi[i] >= PLANTS_NDVI) {
        kind = PLANTS_GAINED; // greener, and now really looks like plants
      } else if (ndviChange <= -NDVI_THRESHOLD && before.ndvi[i] >= PLANTS_NDVI) {
        kind = PLANTS_LOST; // less green, and it really was plants before
      } else if (ndbiChange >= NDBI_THRESHOLD) {
        const wasWet = before.swir[i] < WET_SWIR; // wet ground absorbs short-wave infrared
        const newShadow = after.swir[i] < SHADOW_DARKENING * before.swir[i];
        if (!wasWet && !newShadow) {
          kind = NEW_BUILT_OR_BARE;
        }
      }
    }
    kinds[i] = kind;
  }

  kinds = removeLoneSquares(kinds, grid.columns, grid.rows);

  // Count how many squares there are of each kind
  const counts = { [NO_CHANGE]: 0, [PLANTS_GAINED]: 0, [PLANTS_LOST]: 0, [NEW_BUILT_OR_BARE]: 0, [SKIPPED]: 0 };
  for (let i = 0; i < kinds.length; i++) {
    counts[kinds[i]]++;
  }
  return { kinds: kinds, counts: counts };
}

// Real changes (a building site, a cleared field) cover a patch of ground.
// A single changed square with no matching neighbours is usually just noise,
// so a changed square only stays if at least 2 of its 8 neighbours changed the same way.
function removeLoneSquares(kinds, columns, rows) {
  const kept = new Uint8Array(kinds); // a copy, so our checks always look at the original
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const kind = kinds[row * columns + column];
      if (kind === NO_CHANGE || kind === SKIPPED) continue;

      let sameNeighbours = 0;
      for (let dRow = -1; dRow <= 1; dRow++) {
        for (let dColumn = -1; dColumn <= 1; dColumn++) {
          const r = row + dRow;
          const c = column + dColumn;
          if ((dRow !== 0 || dColumn !== 0) && r >= 0 && r < rows && c >= 0 && c < columns &&
              kinds[r * columns + c] === kind) {
            sameNeighbours++;
          }
        }
      }
      if (sameNeighbours < 2) {
        kept[row * columns + column] = NO_CHANGE;
      }
    }
  }
  return kept;
}

// Paints the changes onto a picture, one picture-pixel per grid square,
// and puts it on the map over the chosen area
function drawChanges(grid, kinds) {
  const canvas = document.createElement("canvas");
  canvas.width = grid.columns;
  canvas.height = grid.rows;
  const context = canvas.getContext("2d");
  const picture = context.createImageData(grid.columns, grid.rows);

  for (let i = 0; i < kinds.length; i++) {
    const colour = CHANGE_COLOURS[kinds[i]]; // undefined for "no change": left see-through
    if (colour) {
      picture.data.set(colour, i * 4); // 4 numbers per pixel: red, green, blue, opacity
    }
  }
  context.putImageData(picture, 0, 0);

  return L.imageOverlay(canvas.toDataURL(), chosenArea, {
    pane: "changesPane",
    className: "change-layer", // style.css keeps the squares sharp instead of blurry
    interactive: false
  });
}

// Writes the percentages into the panel
function showSummary(counts, totalSquares) {
  const compared = totalSquares - counts[SKIPPED];
  function percentOfCompared(count) {
    return compared > 0 ? ((100 * count) / compared).toFixed(1) + "%" : "-";
  }
  const changed = counts[PLANTS_GAINED] + counts[PLANTS_LOST] + counts[NEW_BUILT_OR_BARE];

  document.getElementById("pct-gained").textContent = percentOfCompared(counts[PLANTS_GAINED]);
  document.getElementById("pct-lost").textContent = percentOfCompared(counts[PLANTS_LOST]);
  document.getElementById("pct-built").textContent = percentOfCompared(counts[NEW_BUILT_OR_BARE]);
  document.getElementById("change-total").textContent =
    "Changed: " + percentOfCompared(changed) + " of the " + compared.toLocaleString() +
    " squares that could be compared.";
  document.getElementById("pct-skipped").textContent =
    counts[SKIPPED].toLocaleString() + " squares (" +
    ((100 * counts[SKIPPED]) / totalSquares).toFixed(1) + "% of the area)";
  changeSection.hidden = false;
}

// =====================================================
// 4c. The "Find images" button: puts it all together
// =====================================================

const findButton = document.getElementById("find-button");
const beforeInfo = document.getElementById("before-info");
const afterInfo = document.getElementById("after-info");
const changeSection = document.getElementById("change-section");
const changeToggle = document.getElementById("change-toggle");

let beforeLayer = null; // the Sentinel-2 layers being shown (null = none)
let afterLayer = null;
let changeLayer = null; // the coloured change layer (null = none)

findButton.addEventListener("click", async function () {
  if (!chosenArea) {
    statusText.textContent = "First choose an area: press Draw area or Use visible area.";
    return;
  }
  if (beforeDateInput.value >= afterDateInput.value) {
    statusText.textContent = "The before date must be earlier than the after date.";
    return;
  }

  clearComparison();
  findButton.disabled = true;
  statusText.textContent = "Searching for Sentinel-2 images and checking clouds over your area…";

  try {
    const token = await getToken();

    // Search for both dates at the same time, then pick the best matching pair
    const [beforeList, afterList] = await Promise.all([
      findClearImages(chosenArea, beforeDateInput.value, token),
      findClearImages(chosenArea, afterDateInput.value, token)
    ]);
    const pair = choosePair(beforeList, afterList);

    if (!pair) {
      beforeInfo.textContent = beforeList.length ? "Found" : "No clear image found";
      afterInfo.textContent = afterList.length ? "Found" : "No clear image found";
      statusText.textContent =
        "No image covering the whole area was found within " + SEARCH_WINDOW_DAYS +
        " days of one of the dates. Try other dates or a smaller area.";
      return;
    }
    const before = pair.before;
    const after = pair.after;
    beforeInfo.textContent = describeImage(before);
    afterInfo.textContent = describeImage(after);

    // Choose the brightness range from the pixels in the area, then show the
    // two photos with the swipe slider
    statusText.textContent = "Adjusting the brightness for your area…";
    displayWhite = await findDisplayWhite([before.item, after.item], chosenArea, token).catch(function (error) {
      console.warn("Could not work out the brightness:", error);
      return DEFAULT_DISPLAY_WHITE;
    });
    brightnessSlider.value = 100;
    brightnessText.textContent = "100%";
    brightnessRow.hidden = false;
    beforeLayer = sentinelLayer(before.item, "beforePane").addTo(map);
    afterLayer = sentinelLayer(after.item, "afterPane").addTo(map);
    showSwipe(niceDate(before.item.properties.datetime), niceDate(after.item.properties.datetime));
    updateZoomNote();
    map.fitBounds(chosenArea);

    // Work out what changed (only for areas that aren't too big)
    const widthKm = map.distance(chosenArea.getSouthWest(), chosenArea.getSouthEast()) / 1000;
    const heightKm = map.distance(chosenArea.getSouthWest(), chosenArea.getNorthWest()) / 1000;
    if (widthKm > MAX_CHANGE_AREA_KM || heightKm > MAX_CHANGE_AREA_KM) {
      statusText.textContent =
        "Drag the slider to compare. Changes are only worked out for areas up to " +
        MAX_CHANGE_AREA_KM + " km × " + MAX_CHANGE_AREA_KM + " km, so draw a smaller area to see them.";
    } else {
      statusText.textContent = "Reading the image bands and looking for changes…";
      const grid = makeGrid(chosenArea, CHANGE_PIXEL_METRES);
      const [beforeScores, afterScores] = await Promise.all([
        readScores(before.item, grid, token),
        readScores(after.item, grid, token)
      ]);
      const result = compareScores(beforeScores, afterScores, grid);

      changeLayer = drawChanges(grid, result.kinds).addTo(map);
      changeToggle.textContent = "Hide changes";
      showSummary(result.counts, result.kinds.length);
      statusText.textContent = "Done. Drag the slider to compare the photos under the coloured changes.";
    }

    // Finally, the images in between (section 4e). It shows its own progress.
    await loadTimeSeries(chosenArea, before.item);
  } catch (error) {
    console.warn("Image search or change detection failed:", error);
    statusText.textContent = "Sorry, something went wrong reading the images. Please try again in a moment.";
  } finally {
    findButton.disabled = false;
  }
});

// The "Hide changes / Show changes" button
changeToggle.addEventListener("click", function () {
  if (!changeLayer) return;
  if (map.hasLayer(changeLayer)) {
    changeLayer.remove();
    changeToggle.textContent = "Show changes";
  } else {
    changeLayer.addTo(map);
    changeToggle.textContent = "Hide changes";
  }
});

// =====================================================
// 4d. Showing the photos with clear detail
// =====================================================
// Sentinel-2's ready-made colour picture ("visual") shows reflectance from 0 to
// 0.25 and turns anything brighter pure white. Desert sand reflects 0.3 to 0.5,
// so the desert came out almost white. Instead, we ask the tile service to make
// the picture from the red, green and blue bands (B04, B03, B02), and tell it
// which range of values to stretch from black to white ("rescale").

let displayWhite = DEFAULT_DISPLAY_WHITE; // the reflectance shown as white

// Looks at the red, green and blue pixels inside the area in both photos, and
// finds how bright the brightest 2% are. Both photos use the same white point,
// so they can be compared fairly, and all three colours use it too, so colours
// stay natural.
async function findDisplayWhite(items, area, token) {
  // Up to about 150 x 150 sample points, at least 20 m apart
  const widthMetres = map.distance(area.getSouthWest(), area.getSouthEast());
  const heightMetres = map.distance(area.getSouthWest(), area.getNorthWest());
  const grid = makeGrid(area, Math.max(20, Math.max(widthMetres, heightMetres) / 150));

  const perPhoto = await Promise.all(
    items.map(async function (item) {
      const projected = projectGrid(grid, item);
      const bands = await Promise.all(
        ["B04", "B03", "B02"].map(function (band) {
          return readBandOnGrid(item, band, token, projected);
        })
      );
      const offset = storedOffset(item);
      const values = [];
      for (const band of bands) {
        for (const value of band) {
          if (value > 0) values.push((value - offset) / 10000); // 0 = no data
        }
      }
      return values;
    })
  );

  const all = Float32Array.from(perPhoto.flat()).sort(); // smallest to largest
  if (all.length === 0) return DEFAULT_DISPLAY_WHITE;
  const white = all[Math.floor(((all.length - 1) * DISPLAY_BRIGHT_PERCENT) / 100)];
  return Math.max(white, 0.05); // never closer to black than 0.05, even over dark water
}

// The web address of a photo's map tiles, using the current brightness range
function tileUrlFor(item) {
  // The brightness slider lowers the white point (brighter picture) or raises
  // it (darker picture). 100% = the automatic white point.
  const brightness = brightnessSlider.value / 100;
  const white = displayWhite / brightness;
  // Turn reflectance back into the numbers stored in this photo's files
  const offset = storedOffset(item);
  const toStored = function (reflectance) {
    return Math.round(reflectance * 10000 + offset);
  };
  return (
    TILE_URL +
    "?collection=sentinel-2-l2a&item=" + item.id +
    "&assets=B04&assets=B03&assets=B02" + // red, green, blue
    "&nodata=0" +
    // Blend neighbouring 10 m pixels smoothly instead of drawing hard squares:
    // "resampling" when the photo is enlarged, "reproject" when it is turned
    // from the satellite's UTM grid into map tiles. "padding" reads 1 pixel
    // past each tile edge, so the blending doesn't leave lines between tiles.
    "&resampling=bilinear&reproject=bilinear&padding=1" +
    "&rescale=" + toStored(0) + "," + toStored(white) // black, white
  );
}

// Makes a map layer that shows one Sentinel-2 photo.
// bounds: only load the part inside our area, so the rest of the map stays normal.
function sentinelLayer(item, pane) {
  const layer = L.tileLayer(tileUrlFor(item), {
    pane: pane,
    bounds: chosenArea,
    maxZoom: 19,
    maxNativeZoom: SENTINEL_SHARPEST_ZOOM, // closer than this, tiles are just enlarged
    attribution: "Contains modified Copernicus Sentinel data, via Microsoft Planetary Computer"
  });
  layer.item = item; // remember which photo it shows, for the brightness slider
  return layer;
}

// --- "Zoom out for a clearer image" note ---
const zoomNote = document.getElementById("zoom-note");

// Shown while photos are on the map and you're zoomed in past what 10 m pixels can show
function updateZoomNote() {
  zoomNote.hidden = !(beforeLayer && map.getZoom() > SENTINEL_SHARPEST_ZOOM);
}
map.on("zoomend", updateZoomNote);

// =====================================================
// 4e. Time series and timelapse
// =====================================================
// Between the before and after dates we look for one clear image about every
// 2 weeks. All of them are taken from the same satellite path and stored in
// the same 110 km tile as the before image, so they line up with each other
// (see choosePair). For each one we work out the average plant score (NDVI)
// and built-up score (NDBI) over the area, and draw them on a small chart.
// Click a point to see that image on the map, or press Play to see them all
// in date order.
// To keep downloads small, we don't read the image files ourselves here: their
// pixels are stored in blocks about 10 km across, so even a small area costs
// about 2 MB per image. Instead the Planetary Computer cuts out just our area,
// at no more than SERIES_SAMPLE_POINTS x SERIES_SAMPLE_POINTS points, with all
// five bands in one small file (about 120 KB).

const seriesSection = document.getElementById("series-section");
const seriesStatus = document.getElementById("series-status");
const seriesProgress = document.getElementById("series-progress");
const seriesChart = document.getElementById("series-chart");
const seriesReadout = document.getElementById("series-readout");
const seriesPlayer = document.getElementById("series-player");
const playButton = document.getElementById("play-button");
const speedSelect = document.getElementById("speed-select");
const backButton = document.getElementById("back-button");
const frameDate = document.getElementById("frame-date");

let seriesRun = 0; // counts runs; when a new one starts, older ones stop (like lookupNumber)
let series = []; // the clear images found, in date order: { item, areaCloud, ndvi, ndbi }
let seriesFrom = null; // the date range the chart shows
let seriesTo = null;

async function loadTimeSeries(area, beforeItem) {
  seriesRun = seriesRun + 1;
  const thisRun = seriesRun;
  function stillWanted() {
    return thisRun === seriesRun;
  }

  seriesSection.hidden = false;
  seriesPlayer.hidden = true;
  seriesChart.innerHTML = "";
  seriesReadout.textContent = "";
  seriesProgress.hidden = false;
  seriesProgress.removeAttribute("value"); // a moving bar: we don't know how long yet
  seriesStatus.textContent = "Searching for images between the two dates…";

  try {
    seriesFrom = new Date(beforeDateInput.value + "T00:00:00Z");
    seriesTo = new Date(Math.min(new Date(afterDateInput.value + "T23:59:59Z").getTime(), Date.now()));

    // Every image of the area in the date range, from the same path and tile as the before image
    const all = await searchAllImages(area, seriesFrom, seriesTo);
    const sameView = all.filter(function (item) {
      return item.properties["sat:relative_orbit"] === beforeItem.properties["sat:relative_orbit"] &&
             item.properties["s2:mgrs_tile"] === beforeItem.properties["s2:mgrs_tile"] &&
             coversArea(item.geometry, area);
    });
    if (!stillWanted()) return;

    // Put them into 2-week periods (longer if the range is very long)
    const totalDays = (seriesTo - seriesFrom) / ONE_DAY;
    const stepDays = Math.max(SERIES_STEP_DAYS, totalDays / SERIES_MAX_IMAGES);
    const periods = [];
    for (const item of sameView) {
      const index = Math.floor((new Date(item.properties.datetime) - seriesFrom) / (stepDays * ONE_DAY));
      if (!periods[index]) periods[index] = [];
      periods[index].push(item);
    }
    const filled = periods.filter(Boolean); // leave out periods with no images at all
    for (const candidates of filled) {
      // least cloudy (over the whole 110 km photo) first
      candidates.sort(function (a, b) {
        return a.properties["eo:cloud_cover"] - b.properties["eo:cloud_cover"];
      });
    }

    // Check the periods a few at a time, updating the progress bar as each finishes
    const widthMetres = map.distance(area.getSouthWest(), area.getSouthEast());
    const heightMetres = map.distance(area.getSouthWest(), area.getNorthWest());
    const grid = makeGrid(area, Math.max(20, Math.max(widthMetres, heightMetres) / SERIES_SAMPLE_POINTS));
    let checked = 0;
    seriesProgress.max = filled.length;
    seriesProgress.value = 0;
    seriesStatus.textContent = "Checking images: 0 of " + filled.length + " periods…";

    const found = await runFewAtATime(filled, SERIES_PARALLEL, async function (candidates) {
      const point = await clearestInPeriod(candidates, area, grid, stillWanted);
      checked = checked + 1;
      if (stillWanted()) {
        seriesProgress.value = checked;
        seriesStatus.textContent = "Checking images: " + checked + " of " + filled.length + " periods…";
      }
      return point;
    });
    if (!stillWanted()) return;

    series = found.filter(Boolean).sort(function (a, b) {
      return new Date(a.item.properties.datetime) - new Date(b.item.properties.datetime);
    });
    seriesProgress.hidden = true;
    if (series.length === 0) {
      seriesStatus.textContent = "No clear images were found between the two dates.";
      return;
    }
    seriesStatus.textContent =
      series.length + " clear images (at most " + SERIES_MAX_CLOUD + "% cloud over the area). " +
      "Click a point to see that image.";
    drawSeriesChart();
    seriesPlayer.hidden = false;
  } catch (error) {
    if (!stillWanted()) return;
    console.warn("Time series failed:", error);
    seriesProgress.hidden = true;
    seriesStatus.textContent = "Sorry, the images between the two dates couldn't be loaded.";
  }
}

// Asks the catalogue for every image of the area in a date range. If there are
// more than fit in one answer, the answer has a "next" link to the rest.
async function searchAllImages(area, from, to) {
  let url =
    STAC_SEARCH_URL +
    "?collections=sentinel-2-l2a" +
    "&bbox=" + [area.getWest(), area.getSouth(), area.getEast(), area.getNorth()].join(",") +
    "&datetime=" + from.toISOString() + "/" + to.toISOString() +
    "&limit=1000";
  const items = [];
  while (url) {
    const data = await fetchJson(url);
    items.push(...data.features);
    const next = (data.links || []).find(function (link) {
      return link.rel === "next";
    });
    url = next ? next.href : null;
  }
  return items;
}

// Tries the least cloudy images of one period until one is clear over the area
// (the same check as areaCloudPercent, using the scene classification band)
async function clearestInPeriod(candidates, area, grid, stillWanted) {
  for (const item of candidates.slice(0, SERIES_TRIES)) {
    if (!stillWanted()) return null;
    try {
      const bands = await readAreaCutout(item, area, grid);
      const areaCloud = percentHidden(bands[4]); // band 5 is SCL
      if (areaCloud > SERIES_MAX_CLOUD) continue; // too cloudy: try the next one

      const averages = averageScores(scoresFromBands(item, bands));
      if (averages) {
        return { item: item, areaCloud: areaCloud, ndvi: averages.ndvi, ndbi: averages.ndbi };
      }
    } catch (error) {
      console.warn("Could not read " + item.id + ":", error); // try the next one
    }
  }
  return null; // no clear image in this period
}

// Asks the Planetary Computer for the five SCORE_BANDS over just the area, as a
// small GeoTIFF with one pixel per grid point. Its rows and columns run along
// latitude and longitude, from the north-west corner, exactly like makeGrid,
// so pixel i is grid point i. "nearest" keeps SCL's class numbers exact.
async function readAreaCutout(item, area, grid) {
  const url =
    CUTOUT_URL + [area.getWest(), area.getSouth(), area.getEast(), area.getNorth()].join(",") +
    "/" + grid.columns + "x" + grid.rows + ".tif" +
    "?collection=sentinel-2-l2a&item=" + item.id +
    SCORE_BANDS.map(function (band) { return "&assets=" + band; }).join("") +
    "&resampling=nearest&reproject=nearest";
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("The cut-out failed with error " + response.status);
  const tiff = await GeoTIFF.fromArrayBuffer(await response.arrayBuffer());
  const image = await tiff.getImage();
  const bands = await image.readRasters();
  return bands.slice(0, SCORE_BANDS.length); // (a 6th band says which pixels have data; not needed)
}

// The average NDVI and NDBI over the clear, dry-land squares
// (water is left out, as in compareScores). null if almost nothing is clear.
function averageScores(scores) {
  let ndviTotal = 0;
  let ndbiTotal = 0;
  let count = 0;
  for (let i = 0; i < scores.ndvi.length; i++) {
    if (scores.usable[i] && !scores.water[i]) {
      ndviTotal = ndviTotal + scores.ndvi[i];
      ndbiTotal = ndbiTotal + scores.ndbi[i];
      count = count + 1;
    }
  }
  if (count < scores.ndvi.length * 0.1) return null;
  return { ndvi: ndviTotal / count, ndbi: ndbiTotal / count };
}

// Runs "work" on every entry of a list, a few at a time (so the image server
// isn't asked for too much at once), and returns the answers in the same order
async function runFewAtATime(list, howMany, work) {
  const answers = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next;
      next = next + 1;
      answers[i] = await work(list[i]);
    }
  }
  const workers = [];
  for (let w = 0; w < howMany; w++) workers.push(worker());
  await Promise.all(workers);
  return answers;
}

// --- The chart ---
// Both scores go from -1 to +1, so they share one vertical scale.
// Points are placed by date, so gaps (cloudy weeks) show as gaps.
const NDVI_COLOUR = "#2a78d6"; // blue
const NDBI_COLOUR = "#eb6834"; // orange

function drawSeriesChart() {
  const width = 276;
  const height = 150;
  const left = 32; // room for the numbers on the left
  const right = 8;
  const top = 8;
  const bottom = 20; // room for the dates underneath
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  // The vertical range: just past the lowest and highest values, in steps of 0.1
  const values = series.flatMap(function (point) { return [point.ndvi, point.ndbi]; });
  const lowest = Math.floor((Math.min(...values) - 0.02) * 10) / 10;
  const highest = Math.ceil((Math.max(...values) + 0.02) * 10) / 10;
  const step = highest - lowest > 0.6 ? 0.2 : 0.1;

  function xFor(point) {
    const fraction = (new Date(point.item.properties.datetime) - seriesFrom) / (seriesTo - seriesFrom);
    return left + fraction * plotWidth;
  }
  function yFor(value) {
    return top + ((highest - value) / (highest - lowest)) * plotHeight;
  }

  let svg = "";
  // Faint grid lines, with their values on the left
  for (let value = lowest; value <= highest + 0.001; value += step) {
    const y = yFor(value).toFixed(1);
    const isZero = Math.abs(value) < 0.001;
    svg += '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + y + '" y2="' + y +
           '" class="' + (isZero ? "grid zero" : "grid") + '"/>';
    svg += '<text x="' + (left - 4) + '" y="' + y + '" class="axis-label" text-anchor="end" dy="0.32em">' +
           (isZero ? "0" : value.toFixed(1)) + "</text>";
  }
  // The first and last dates underneath
  svg += '<text x="' + left + '" y="' + (height - 4) + '" class="axis-label">' +
         niceDate(seriesFrom.toISOString()) + "</text>";
  svg += '<text x="' + (width - right) + '" y="' + (height - 4) + '" class="axis-label" text-anchor="end">' +
         niceDate(seriesTo.toISOString()) + "</text>";

  // The line marking the image on the map (moved by markFrame)
  svg += '<line id="frame-marker" class="frame-marker" y1="' + top + '" y2="' + (top + plotHeight) + '"/>';

  // One line and a dot per image, for each score
  for (const [key, colour] of [["ndvi", NDVI_COLOUR], ["ndbi", NDBI_COLOUR]]) {
    const points = series.map(function (point) {
      return xFor(point).toFixed(1) + "," + yFor(point[key]).toFixed(1);
    });
    svg += '<polyline points="' + points.join(" ") + '" fill="none" stroke="' + colour +
           '" stroke-width="2" stroke-linejoin="round"/>';
    for (const xy of points) {
      const [x, y] = xy.split(",");
      svg += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + colour + '" class="dot"/>';
    }
  }

  // Invisible strips, one per image, that are easy to hover and click
  // (much bigger than the dots). Each reaches halfway to its neighbours.
  for (let i = 0; i < series.length; i++) {
    const x = xFor(series[i]);
    const from = i > 0 ? (xFor(series[i - 1]) + x) / 2 : left;
    const to = i < series.length - 1 ? (x + xFor(series[i + 1])) / 2 : width - right;
    svg += '<rect x="' + from.toFixed(1) + '" y="' + top + '" width="' + (to - from).toFixed(1) +
           '" height="' + plotHeight + '" class="hit" data-index="' + i + '" data-x="' + x.toFixed(1) + '"/>';
  }

  seriesChart.innerHTML =
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Average plant score (NDVI) and ' +
    'built-up score (NDBI) of the area over time">' + svg + "</svg>";
  markFrame();
}

// Words for one point, e.g. "12 Mar 2026: plants 0.08, built-up 0.15, 2% cloud"
function describePoint(point) {
  return niceDate(point.item.properties.datetime) + ": plants " + point.ndvi.toFixed(2) +
         ", built-up " + point.ndbi.toFixed(2) + ", " + Math.round(point.areaCloud) + "% cloud";
}

// Hovering over the chart shows that image's numbers; leaving shows the image on the map again
seriesChart.addEventListener("mouseover", function (event) {
  const index = event.target.dataset.index;
  if (index !== undefined) seriesReadout.textContent = describePoint(series[index]);
});
seriesChart.addEventListener("mouseleave", markFrame);

// Clicking shows that image on the map
seriesChart.addEventListener("click", function (event) {
  const index = event.target.dataset.index;
  if (index === undefined) return;
  pause();
  showFrame(Number(index));
});

// Moves the chart's marker line and the date on the map to the image being shown
function markFrame() {
  const marker = document.getElementById("frame-marker");
  const strip = seriesChart.querySelector('[data-index="' + frameIndex + '"]');
  if (frameIndex < 0 || !strip) {
    if (marker) marker.style.display = "none";
    seriesReadout.textContent = series.length ? "Hover over the chart to see the numbers." : "";
    frameDate.hidden = true;
    return;
  }
  marker.style.display = "";
  marker.setAttribute("x1", strip.dataset.x);
  marker.setAttribute("x2", strip.dataset.x);
  seriesReadout.textContent = describePoint(series[frameIndex]);
  frameDate.textContent =
    niceDate(series[frameIndex].item.properties.datetime) + "  ·  " + (frameIndex + 1) + " of " + series.length;
  frameDate.hidden = false;
}

// --- Showing one image of the series on the map ---
// Each image gets its own tile layer. The new one loads on top of the old one,
// and the old one is only removed once the new one has finished, so the map
// never flashes empty between frames.
let frameIndex = -1; // which image of the series is on the map (-1 = none: showing before/after)
let shownFrameLayer = null; // the image on the map
let loadingFrameLayer = null; // the next image, while its tiles load

// Returns a promise that finishes when the image has loaded (or after 5 seconds,
// so one slow tile can't stop the timelapse)
function showFrame(index) {
  frameIndex = index;
  markFrame();
  backButton.hidden = false;
  swipeLine.hidden = true; // the before/after cut doesn't apply while a frame is shown

  if (loadingFrameLayer) loadingFrameLayer.remove(); // an older frame that never finished
  const layer = sentinelLayer(series[index].item, "seriesPane");
  loadingFrameLayer = layer;

  return new Promise(function (resolve) {
    function finished() {
      if (loadingFrameLayer === layer) {
        if (shownFrameLayer) shownFrameLayer.remove();
        shownFrameLayer = layer;
        loadingFrameLayer = null;
      }
      resolve();
    }
    layer.once("load", finished);
    setTimeout(finished, 5000);
    layer.addTo(map);
  });
}

// Leaves the timelapse: removes the series image so before/after shows again
function showBeforeAfter() {
  pause();
  if (shownFrameLayer) shownFrameLayer.remove();
  if (loadingFrameLayer) loadingFrameLayer.remove();
  shownFrameLayer = null;
  loadingFrameLayer = null;
  frameIndex = -1;
  backButton.hidden = true;
  if (beforeLayer) swipeLine.hidden = false;
  markFrame();
}

backButton.addEventListener("click", showBeforeAfter);

// --- The timelapse player ---
let playing = false;
let playNumber = 0; // like seriesRun: pressing Play again stops an older loop

playButton.addEventListener("click", function () {
  if (playing) {
    pause();
  } else {
    play();
  }
});

// Shows the images one after another in date order, starting again at the end
async function play() {
  if (series.length === 0) return;
  playing = true;
  playNumber = playNumber + 1;
  const thisPlay = playNumber;
  playButton.textContent = "Pause";

  let index = frameIndex >= 0 && frameIndex < series.length - 1 ? frameIndex + 1 : 0;
  while (true) {
    await showFrame(index); // wait for the image to load...
    if (!playing || thisPlay !== playNumber) return;
    await new Promise(function (resolve) {
      setTimeout(resolve, Number(speedSelect.value)); // ...then let it stay on screen a moment
    });
    if (!playing || thisPlay !== playNumber) return;
    index = (index + 1) % series.length;
  }
}

function pause() {
  playing = false;
  playButton.textContent = "Play";
}

// Removes everything the time series added (used when the area or images change)
function clearTimeSeries() {
  seriesRun = seriesRun + 1; // stops a run that's still loading
  showBeforeAfter();
  series = [];
  seriesChart.innerHTML = "";
  seriesSection.hidden = true;
}

// --- The brightness slider ---
const brightnessRow = document.getElementById("brightness-row");
const brightnessSlider = document.getElementById("brightness-slider");
const brightnessText = document.getElementById("brightness-value");

// While dragging, just show the number
brightnessSlider.addEventListener("input", function () {
  brightnessText.textContent = brightnessSlider.value + "%";
});

// When the slider is let go, redraw both photos with the new brightness
brightnessSlider.addEventListener("change", function () {
  for (const layer of [beforeLayer, afterLayer, shownFrameLayer, loadingFrameLayer]) {
    if (layer) layer.setUrl(tileUrlFor(layer.item));
  }
});

// Turns "2026-07-31T06:46:29Z" into "31 Jul 2026"
function niceDate(isoText) {
  return new Date(isoText).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function describeImage(found) {
  if (!found) return "No clear image found";
  return niceDate(found.item.properties.datetime) + ", " + Math.round(found.areaCloud) + "% cloud over the area";
}

// Removes the Sentinel-2 images, the change layer and the slider
function clearComparison() {
  if (beforeLayer) beforeLayer.remove();
  if (afterLayer) afterLayer.remove();
  if (changeLayer) changeLayer.remove();
  beforeLayer = null;
  afterLayer = null;
  changeLayer = null;
  beforeInfo.textContent = "-";
  afterInfo.textContent = "-";
  changeSection.hidden = true;
  brightnessRow.hidden = true;
  zoomNote.hidden = true;
  clearTimeSeries();
  swipeBar.hidden = true;
  swipeLine.hidden = true;
}

// =====================================================
// 5. The before/after swipe slider
// =====================================================
// Both images are on the map at once, one on top of the other. We cut each
// one off at the slider's position: "before" shows to the left of the line,
// "after" to the right. Moving the slider moves the cut. Both are also cut
// to the edges of the chosen area, because map tiles are big squares that
// would otherwise spill past it.

const swipeBar = document.getElementById("swipe-bar");
const swipeSlider = document.getElementById("swipe-slider");
const swipeLine = document.getElementById("swipe-line");

function showSwipe(beforeDate, afterDate) {
  document.getElementById("swipe-before-label").textContent = "Before: " + beforeDate;
  document.getElementById("swipe-after-label").textContent = "After: " + afterDate;
  swipeBar.hidden = false;
  swipeLine.hidden = false;
  updateSwipe();
}

function updateSwipe() {
  if (!beforeLayer) return;

  // Where the cut is, in pixels from the left edge of the map
  const mapSize = map.getSize();
  const cutX = (mapSize.x * swipeSlider.value) / 100;
  swipeLine.style.left = cutX + "px";

  // The panes move around when you drag the map, so we work in the panes'
  // own positions ("layer points") instead of screen positions.
  const cut = map.containerPointToLayerPoint([cutX, 0]).x;
  const areaTopLeft = map.latLngToLayerPoint(chosenArea.getNorthWest());
  const areaBottomRight = map.latLngToLayerPoint(chosenArea.getSouthEast());
  const top = areaTopLeft.y;
  const bottom = areaBottomRight.y;
  const left = areaTopLeft.x;
  const right = areaBottomRight.x;

  // CSS "clip: rect(top, right, bottom, left)" hides everything outside the rectangle.
  // "before" goes from the area's left edge to the cut; "after" from the cut to the right edge.
  map.getPane("beforePane").style.clip =
    "rect(" + top + "px, " + Math.min(cut, right) + "px, " + bottom + "px, " + left + "px)";
  map.getPane("afterPane").style.clip =
    "rect(" + top + "px, " + right + "px, " + bottom + "px, " + Math.max(cut, left) + "px)";
  // A time-series image fills the whole area
  map.getPane("seriesPane").style.clip =
    "rect(" + top + "px, " + right + "px, " + bottom + "px, " + left + "px)";
}

swipeSlider.addEventListener("input", function () {
  showBeforeAfter(); // moving the slider leaves the timelapse and goes back to before/after
  updateSwipe();
});
map.on("move zoomend resize", updateSwipe); // keep the cut in place when the map moves

// =====================================================
// 6. Place details for the centre of the chosen area:
//    elevation, weather, climate, soil, land cover and wildlife
// =====================================================
// All of these are free websites that need no API key.
// Each one is fetched separately, so if one fails or has no data,
// only that line says "Not available" and the rest still work.

// Counts lookups. If you choose a new area while answers are still
// arriving, the old answers are ignored so they can't overwrite new ones.
let lookupNumber = 0;

function lookUpPlace(position) {
  lookupNumber = lookupNumber + 1;
  const thisLookup = lookupNumber;

  const lat = position.lat.toFixed(4); // 4 decimal places is about 10 metres
  const lng = position.lng.toFixed(4);
  document.getElementById("place-coords").textContent = "(" + lat + ", " + lng + ")";

  showDetail("detail-elevation", getElevation, lat, lng, thisLookup);
  showDetail("detail-weather", getWeather, lat, lng, thisLookup);
  showDetail("detail-climate", getClimate, lat, lng, thisLookup);
  showDetail("detail-soil", getSoil, lat, lng, thisLookup);
  showDetail("detail-landcover", getLandCover, lat, lng, thisLookup);
  showDetail("detail-wildlife", getWildlife, lat, lng, thisLookup);
}

// Runs one "get..." function and puts its answer on the panel.
// "async" and "await" mean: wait for the answer from the internet
// without freezing the page while we wait.
async function showDetail(elementId, getText, lat, lng, thisLookup) {
  const element = document.getElementById(elementId);
  element.textContent = "Loading…";

  let text = null;
  try {
    text = await getText(lat, lng);
  } catch (error) {
    // The website failed, timed out, or sent something unexpected.
    // Note it in the browser console (F12) but keep the page working.
    console.warn("Could not load " + elementId + ":", error);
  }

  if (thisLookup !== lookupNumber) {
    return; // a newer area was chosen since; its lookup will fill this in
  }
  element.textContent = text || "Not available";
}

// Downloads data from a website and reads it as JSON (a common data format).
// Gives up after 20 seconds so a slow website can't leave us waiting forever.
async function fetchJson(url, options = {}) {
  options.signal = AbortSignal.timeout(20000);
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error("The website answered with error " + response.status);
  }
  return response.json();
}

// --- Elevation (Open-Meteo) ---
async function getElevation(lat, lng) {
  const data = await fetchJson(
    "https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lng
  );
  const metres = data.elevation[0];
  return Math.round(metres) + " m above sea level";
}

// --- Current weather (Open-Meteo) ---
async function getWeather(lat, lng) {
  const data = await fetchJson(
    "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
  );
  const now = data.current;
  return (
    Math.round(now.temperature_2m) + "°C, " + describeWeather(now.weather_code) +
    ", humidity " + now.relative_humidity_2m + "%, wind " + Math.round(now.wind_speed_10m) + " km/h"
  );
}

// Weather websites use number codes for the sky (the "WMO code").
// This turns the number into words.
function describeWeather(code) {
  if (code === 0) return "clear sky";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

// --- Climate (Open-Meteo historical weather for last year) ---
// Climate means the usual weather over a long time, so we take every
// day of last year and work out the average temperature and total rain.
async function getClimate(lat, lng) {
  const lastYear = new Date().getFullYear() - 1;
  const data = await fetchJson(
    "https://archive-api.open-meteo.com/v1/archive?latitude=" + lat + "&longitude=" + lng +
      "&start_date=" + lastYear + "-01-01&end_date=" + lastYear + "-12-31" +
      "&daily=temperature_2m_mean,precipitation_sum"
  );

  // Add up the daily numbers (skipping any missing days, which are null)
  let temperatureTotal = 0;
  let dayCount = 0;
  let rainTotal = 0;
  for (let i = 0; i < data.daily.time.length; i++) {
    const temperature = data.daily.temperature_2m_mean[i];
    const rain = data.daily.precipitation_sum[i];
    if (temperature !== null) {
      temperatureTotal = temperatureTotal + temperature;
      dayCount = dayCount + 1;
    }
    if (rain !== null) {
      rainTotal = rainTotal + rain;
    }
  }
  if (dayCount === 0) return null;

  const averageTemperature = temperatureTotal / dayCount;
  return (
    describeRainfall(rainTotal) + ". In " + lastYear + ": average " +
    averageTemperature.toFixed(1) + "°C, " + Math.round(rainTotal) + " mm of rain"
  );
}

// A rough description of how dry or wet a place is, from yearly rainfall
function describeRainfall(mmPerYear) {
  if (mmPerYear < 250) return "Very dry (desert)";
  if (mmPerYear < 500) return "Dry (semi-arid)";
  if (mmPerYear < 1000) return "Moderate rainfall";
  return "Wet";
}

// --- Soil type (ISRIC SoilGrids) ---
// SoilGrids gives the soil's scientific group name. This website is slow
// (it often takes about 7 seconds), so this line usually fills in last.
async function getSoil(lat, lng) {
  const data = await fetchJson(
    "https://rest.isric.org/soilgrids/v2.0/classification/query?lon=" + lng + "&lat=" + lat +
      "&number_classes=1"
  );
  const soilName = data.wrb_class_name;
  if (!soilName) return null; // e.g. over the sea, where there is no soil data

  const meaning = SOIL_MEANINGS[soilName];
  return meaning ? soilName + " (" + meaning + ")" : soilName;
}

// Plain-English meanings for soil groups that are common in deserts and drylands
const SOIL_MEANINGS = {
  Arenosols: "sandy soil",
  Calcisols: "soil rich in lime",
  Cambisols: "young, developing soil",
  Fluvisols: "soil laid down by rivers or the sea",
  Gypsisols: "soil rich in gypsum",
  Leptosols: "thin, rocky soil",
  Luvisols: "fertile soil with clay below",
  Regosols: "loose, young soil",
  Solonchaks: "salty soil",
  Vertisols: "heavy clay that cracks when dry"
};

// --- Land cover (OpenStreetMap, using the Overpass API) ---
// Asks OpenStreetMap which mapped areas (parks, farmland, sand, water...)
// the spot is inside. Volunteers draw these areas, so some
// places, especially open desert, may have nothing mapped.
async function getLandCover(lat, lng) {
  const query =
    "[out:json][timeout:15];" +
    "is_in(" + lat + "," + lng + ")->.here;" +
    "(area.here[landuse];area.here[natural];area.here[leisure];);" +
    "out tags;";
  const data = await fetchJson("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: new URLSearchParams({ data: query })
  });

  // Collect the names, e.g. "grass", "sand", "park", without repeats
  const names = [];
  for (const area of data.elements) {
    const tag = area.tags.landuse || area.tags.natural || area.tags.leisure;
    const name = tag.replace(/_/g, " "); // "nature_reserve" becomes "nature reserve"
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  if (names.length === 0) return null;
  return names.join(", ");
}

// --- Wildlife recorded nearby (GBIF) ---
// GBIF collects sightings of living things from scientists and the public.
// We ask for the 5 animal species seen most often within 5 km.
async function getWildlife(lat, lng) {
  const data = await fetchJson(
    "https://api.gbif.org/v1/occurrence/search?geoDistance=" + lat + "," + lng + ",5km" +
      "&kingdomKey=1&hasCoordinate=true&occurrenceStatus=PRESENT" + // kingdomKey 1 = animals
      "&limit=0&facet=speciesKey&facetLimit=5"
  );
  if (!data.facets || data.facets.length === 0) return null;

  const topSpecies = data.facets[0].counts; // a list of species ID numbers
  if (topSpecies.length === 0) return null;

  // GBIF gives ID numbers, so look up each species' name (all at the same time)
  const names = await Promise.all(
    topSpecies.map(function (species) {
      return getSpeciesName(species.name);
    })
  );
  return names.join(", ") + " (" + data.count.toLocaleString() + " animal records within 5 km)";
}

async function getSpeciesName(speciesId) {
  try {
    const species = await fetchJson("https://api.gbif.org/v1/species/" + speciesId);
    // Use the everyday name if there is one, otherwise the scientific name
    return species.vernacularName || species.canonicalName || "unknown species";
  } catch (error) {
    return "unknown species";
  }
}


// =====================================================
// 7. "Locate me" button: show your real location
// =====================================================

const locateStatusText = document.getElementById("locate-status");
let myLocationMarker = null; // the blue dot, created the first time we find you

document.getElementById("locate-button").addEventListener("click", function () {
  if (!navigator.geolocation) {
    locateStatusText.textContent = "Sorry, this browser can't detect your location.";
    return;
  }

  locateStatusText.textContent = "Finding your location…";

  // Ask the browser where we are. The browser asks your permission first.
  // It calls showMyLocation if it works, or showLocationError if it doesn't.
  navigator.geolocation.getCurrentPosition(showMyLocation, showLocationError, {
    enableHighAccuracy: true,
    timeout: 15000 // give up after 15 seconds
  });
});

function showMyLocation(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy; // in metres

  // Remove the old blue dot (if there is one) before drawing the new one
  if (myLocationMarker) {
    myLocationMarker.remove();
  }
  myLocationMarker = L.circleMarker([lat, lng], {
    radius: 9,
    color: "white",
    weight: 3,
    fillColor: "#1a73e8",
    fillOpacity: 1
  })
    .addTo(map)
    .bindTooltip("You are here");

  map.setView([lat, lng], 15);
  locateStatusText.textContent =
    "You: " + lat.toFixed(5) + ", " + lng.toFixed(5) + " (±" + Math.round(accuracy) + " m)";
}

function showLocationError(error) {
  locateStatusText.textContent = "Couldn't get your location: " + error.message;
}
