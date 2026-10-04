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
