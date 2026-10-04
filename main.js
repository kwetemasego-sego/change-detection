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

// Microsoft Planetary Computer: a free catalogue of Sentinel-2 images, plus a
// service that turns any image into map tiles. Neither needs an API key.
const STAC_SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const TILE_URL = "https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png";

// =====================================================
// 1. The map, with satellite photos and labels
// =====================================================

const map = L.map("map", { maxZoom: 19 }).setView([START_LAT, START_LNG], START_ZOOM);

// "Panes" are layers of the map stacked on top of each other, like sheets of
// glass. We make our own, so the Sentinel-2 images sit above the normal map
// but below the street and place names. Higher zIndex = closer to the top.
map.createPane("beforePane").style.zIndex = 250;
map.createPane("afterPane").style.zIndex = 260;
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
// Sentinel-2 is a pair of European satellites (now three) that photograph
// the whole Earth every few days. Each photo ("item") covers a square about
// 110 km across. We ask the Planetary Computer catalogue for every photo of
// our area taken within SEARCH_WINDOW_DAYS of the date, then choose one.

const ONE_DAY = 24 * 60 * 60 * 1000; // in milliseconds

async function findClearestImage(area, dateText) {
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
  if (covering.length === 0) return null;

  // Give each photo a score: its cloud cover (%), plus a little for each day
  // away from the chosen date. The lowest score is the clearest nearby photo.
  function score(item) {
    const daysAway = Math.abs(new Date(item.properties.datetime) - date) / ONE_DAY;
    return item.properties["eo:cloud_cover"] + daysAway * DAY_PENALTY;
  }
  covering.sort(function (a, b) {
    return score(a) - score(b);
  });
  return covering[0];
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

// Makes a map layer that shows one Sentinel-2 photo, using the Planetary
// Computer's tile service. "visual" is the ready-made true-colour picture.
// bounds: only load the part inside our area, so the rest of the map stays normal.
function sentinelLayer(item, pane) {
  return L.tileLayer(
    TILE_URL +
      "?collection=sentinel-2-l2a&item=" + item.id +
      "&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0",
    {
      pane: pane,
      bounds: chosenArea,
      maxZoom: 19,
      maxNativeZoom: 16, // Sentinel-2 pixels are 10 m; closer than this, tiles are just enlarged
      attribution: "Contains modified Copernicus Sentinel data, via Microsoft Planetary Computer"
    }
  );
}

// Turns "2026-07-31T06:46:29Z" into "31 Jul 2026"
function niceDate(isoText) {
  return new Date(isoText).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// --- The "Find images" button ---
const findButton = document.getElementById("find-button");
const beforeInfo = document.getElementById("before-info");
const afterInfo = document.getElementById("after-info");

let beforeLayer = null; // the Sentinel-2 layers being shown (null = none)
let afterLayer = null;

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
  statusText.textContent = "Searching for Sentinel-2 images…";

  try {
    // Search for both dates at the same time
    const [beforeItem, afterItem] = await Promise.all([
      findClearestImage(chosenArea, beforeDateInput.value),
      findClearestImage(chosenArea, afterDateInput.value)
    ]);

    beforeInfo.textContent = describeImage(beforeItem);
    afterInfo.textContent = describeImage(afterItem);

    if (!beforeItem || !afterItem) {
      statusText.textContent =
        "No image covering the whole area was found within " + SEARCH_WINDOW_DAYS +
        " days of one of the dates. Try other dates or a smaller area.";
      return;
    }

    beforeLayer = sentinelLayer(beforeItem, "beforePane").addTo(map);
    afterLayer = sentinelLayer(afterItem, "afterPane").addTo(map);
    showSwipe(niceDate(beforeItem.properties.datetime), niceDate(afterItem.properties.datetime));
    map.fitBounds(chosenArea);
    statusText.textContent = "Drag the slider to swipe between before and after.";
  } catch (error) {
    console.warn("Image search failed:", error);
    statusText.textContent = "Sorry, the image search didn't work. Please try again in a moment.";
  } finally {
    findButton.disabled = false;
  }
});

function describeImage(item) {
  if (!item) return "No clear image found";
  return niceDate(item.properties.datetime) + ", " + Math.round(item.properties["eo:cloud_cover"]) + "% cloud";
}

// Removes the Sentinel-2 images and the slider
function clearComparison() {
  if (beforeLayer) beforeLayer.remove();
  if (afterLayer) afterLayer.remove();
  beforeLayer = null;
  afterLayer = null;
  beforeInfo.textContent = "-";
  afterInfo.textContent = "-";
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
}

swipeSlider.addEventListener("input", updateSwipe);
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
