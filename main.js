// =====================================================
// SETTINGS: change these numbers to tweak the game
// =====================================================

// Where the soldier starts: Abu Dhabi, UAE. Latitude first, then longitude.
const START_LAT = 24.4539;
const START_LNG = 54.3773;
const START_ZOOM = 12; // 1 = whole world, 19 = individual buildings

// The place the soldier is trying to reach (on Al Reem Island)
const TARGET_NAME = "Rally Point Alpha";
const TARGET_LAT = 24.499;
const TARGET_LNG = 54.406;

// How far the soldier moves, measured in screen pixels.
// Because it's in pixels, zooming in lets you move more precisely.
const ARROW_STEP_PIXELS = 10; // each arrow-key press
const WALK_PIXELS_PER_FRAME = 3; // walking speed (about 60 frames per second)

// How long the soldier must stand still before we look up place details.
// 1000 milliseconds = 1 second.
const LOOKUP_DELAY_MS = 1000;

// =====================================================
// 1. Create the map with satellite imagery
// =====================================================

// keyboard: false stops Leaflet using the arrow keys to slide the map,
// because we want the arrow keys to move the soldier instead.
const map = L.map("map", { keyboard: false }).setView([START_LAT, START_LNG], START_ZOOM);

// Esri World Imagery is free to use without an API key,
// as long as we show the credit (the "attribution") in the corner.
L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
  }
).addTo(map);

// =====================================================
// 2. Add the soldier and the target to the map
// =====================================================

// Makes a map marker that shows an emoji instead of the usual blue pin
function emojiIcon(emoji) {
  return L.divIcon({
    html: emoji,
    className: "emoji-icon",
    iconSize: [32, 32],
    iconAnchor: [16, 16] // the centre of the emoji sits exactly on the location
  });
}

const soldier = L.marker([START_LAT, START_LNG], {
  icon: emojiIcon("🪖"),
  zIndexOffset: 1000 // draw the soldier on top of other markers
}).addTo(map);

const target = L.marker([TARGET_LAT, TARGET_LNG], { icon: emojiIcon("🎯") })
  .addTo(map)
  .bindTooltip(TARGET_NAME, { permanent: true, direction: "top", offset: [0, -16] });

// =====================================================
// 3. Distance and compass direction
// =====================================================

// Turns metres into easy-to-read text, e.g. "850 m" or "3.42 km"
function formatDistance(metres) {
  if (metres < 1000) {
    return Math.round(metres) + " m";
  }
  return (metres / 1000).toFixed(2) + " km";
}

// The compass bearing from one place to another, in degrees.
// 0 = north, 90 = east, 180 = south, 270 = west.
// This is the standard "initial bearing" formula used in navigation.
function bearingDegrees(from, to) {
  const toRadians = Math.PI / 180;
  const lat1 = from.lat * toRadians;
  const lat2 = to.lat * toRadians;
  const lngDifference = (to.lng - from.lng) * toRadians;

  const y = Math.sin(lngDifference) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lngDifference);

  const degrees = Math.atan2(y, x) / toRadians; // a number from -180 to 180
  return (degrees + 360) % 360; // change it to a number from 0 to 360
}

// Turns degrees into a compass word, e.g. 47 becomes "NE"
function compassPoint(degrees) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % 8; // each point covers 45 degrees
  return points[index];
}

// =====================================================
// 4. The information panel
// =====================================================

const soldierPositionText = document.getElementById("soldier-position");
const targetInfoText = document.getElementById("target-info");
const locateStatusText = document.getElementById("locate-status");

function updateInfoPanel() {
  const soldierPos = soldier.getLatLng();
  const targetPos = target.getLatLng();

  soldierPositionText.textContent = soldierPos.lat.toFixed(5) + ", " + soldierPos.lng.toFixed(5);

  // map.distance() is built into Leaflet and measures real distance on the Earth
  const metres = map.distance(soldierPos, targetPos);
  const degrees = bearingDegrees(soldierPos, targetPos);
  targetInfoText.textContent =
    formatDistance(metres) + " " + compassPoint(degrees) + " (" + Math.round(degrees) + "°)";
}

// Fill in the panel straight away when the page loads
updateInfoPanel();

// =====================================================
// 5. Moving the soldier
// =====================================================

// Every kind of movement goes through this one function,
// so the panel is always kept up to date.
function moveSoldier(newPosition) {
  soldier.setLatLng(newPosition);
  updateInfoPanel();

  // If the soldier walks off the edge of the screen, slide the map to follow
  if (!map.getBounds().contains(newPosition)) {
    map.panTo(newPosition);
  }

  // Look up details about this place once the soldier stops (see section 7)
  scheduleLookup();
}

let walkDestination = null; // where the soldier is walking to (null = standing still)

// --- Arrow keys ---
document.addEventListener("keydown", function (event) {
  let dx = 0; // pixels to move sideways
  let dy = 0; // pixels to move up or down (on screens, down is positive)

  if (event.key === "ArrowUp") dy = -ARROW_STEP_PIXELS;
  else if (event.key === "ArrowDown") dy = ARROW_STEP_PIXELS;
  else if (event.key === "ArrowLeft") dx = -ARROW_STEP_PIXELS;
  else if (event.key === "ArrowRight") dx = ARROW_STEP_PIXELS;
  else return; // some other key was pressed, so do nothing

  event.preventDefault(); // stop the browser doing its own thing with the arrow keys
  walkDestination = null; // using the keys cancels any walk in progress

  // Convert soldier position -> screen pixels, move it, convert back to lat/lng
  const pixel = map.latLngToContainerPoint(soldier.getLatLng());
  const newPixel = pixel.add([dx, dy]);
  moveSoldier(map.containerPointToLatLng(newPixel));
});

// --- Click to walk ---
map.on("click", function (event) {
  walkDestination = event.latlng;
});

// This runs about 60 times per second. Each time, if the soldier
// has somewhere to go, it takes one small step towards it.
function walkStep() {
  if (walkDestination) {
    const here = map.latLngToContainerPoint(soldier.getLatLng());
    const there = map.latLngToContainerPoint(walkDestination);
    const pixelsLeft = here.distanceTo(there);

    if (pixelsLeft <= WALK_PIXELS_PER_FRAME) {
      // Close enough: finish the walk exactly on the spot that was clicked
      moveSoldier(walkDestination);
      walkDestination = null;
    } else {
      // Take one step along the straight line from here to there
      const step = there.subtract(here).multiplyBy(WALK_PIXELS_PER_FRAME / pixelsLeft);
      moveSoldier(map.containerPointToLatLng(here.add(step)));
    }
  }
  requestAnimationFrame(walkStep); // ask the browser to run this again next frame
}
walkStep();

// =====================================================
// 6. "Locate me" button: show the player's real location
// =====================================================

let myLocationMarker = null; // the blue dot, created the first time we find you

document.getElementById("locate-button").addEventListener("click", function () {
  if (!navigator.geolocation) {
    locateStatusText.textContent = "Sorry, this browser can't detect your location.";
    return;
  }

  locateStatusText.textContent = "Finding your location…";

  // Ask the browser where we are. The browser asks the player's permission first.
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

// =====================================================
// 7. Place details: elevation, weather, climate, soil,
//    land cover and wildlife where the soldier is standing
// =====================================================
// All of these are free websites that need no API key.
// Each one is fetched separately, so if one fails or has no data,
// only that line says "Not available" and the rest still work.

// --- Waiting until the soldier stops ---
// Every step the soldier takes restarts this timer. The lookup only
// happens when the timer finishes, i.e. the soldier has stood still.
let lookupTimer = null;

function scheduleLookup() {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(lookUpPlace, LOOKUP_DELAY_MS);
}

// Counts lookups. If the soldier moves again while answers are still
// arriving, the old answers are ignored so they can't overwrite new ones.
let lookupNumber = 0;

function lookUpPlace() {
  lookupNumber = lookupNumber + 1;
  const thisLookup = lookupNumber;

  const pos = soldier.getLatLng();
  const lat = pos.lat.toFixed(4); // 4 decimal places is about 10 metres
  const lng = pos.lng.toFixed(4);
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
// without freezing the game while we wait.
async function showDetail(elementId, getText, lat, lng, thisLookup) {
  const element = document.getElementById(elementId);
  element.textContent = "Loading…";

  let text = null;
  try {
    text = await getText(lat, lng);
  } catch (error) {
    // The website failed, timed out, or sent something unexpected.
    // Note it in the browser console (F12) but don't break the game.
    console.warn("Could not load " + elementId + ":", error);
  }

  if (thisLookup !== lookupNumber) {
    return; // the soldier has moved since; a newer lookup will fill this in
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
// the soldier is standing inside. Volunteers draw these areas, so some
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

// Look up the starting position as soon as the page loads
lookUpPlace();
