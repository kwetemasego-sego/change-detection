// =====================================================
// SETTINGS: change these numbers to tweak the game
// =====================================================

// The mission takes place in Al Khalidiyah, a neighbourhood of Abu Dhabi.
// Latitude first, then longitude.

// Where the soldier starts: the corner of Wrayq Street and Ash Shoulah Street
const START_LAT = 24.4691;
const START_LNG = 54.34125;
const START_ZOOM = 18; // 18-19 is street level

// The place the soldier is trying to reach: Khalidiya Garden, about 425 m east
const TARGET_NAME = "Rally Point Alpha";
const TARGET_PLACE = "Khalidiya Garden";
const TARGET_LAT = 24.46883;
const TARGET_LNG = 54.34544;
const TARGET_REACHED_DISTANCE = 15; // metres: this close counts as "arrived"

// The player. Real-life speeds, in metres per second.
const WALK_SPEED = 1.5; // a normal walking pace
const RUN_SPEED = 5; // running (hold Shift)
const WATER_SPEED_FACTOR = 0.4; // in water the soldier moves at 40% of normal speed
const PLAYER_MAX_HEALTH = 100;

// Buildings (outlines from OpenStreetMap, in buildings.js)
const PLAYER_RADIUS = 0.5; // metres: how close the soldier's centre can get to a wall
const PATH_GRID_SIZE = 2; // metres: size of each square when finding a path around buildings

// Attacking (press Space)
const ATTACK_RANGE = 20; // metres
const ATTACK_DAMAGE = 34; // so an enemy takes 3 hits
const ATTACK_COOLDOWN_MS = 400; // the soldier can attack at most every 0.4 seconds

// Enemies. Each one patrols back and forth along a real street or path.
// The routes come from OpenStreetMap and live in patrol-routes.js.
const ENEMY_SPEED = 1.2; // metres per second (a slow patrol walk)
const ENEMY_MAX_HEALTH = 100;
const ENEMY_DANGER_RANGE = 25; // metres: closer than this and the player gets hurt
const ENEMY_DAMAGE_PER_SECOND = 8; // health lost per second, for each enemy in range
const ENEMY_SHOT_INTERVAL_MS = 500; // how often an enemy plays its firing animation

// Soldier pictures (from Kenney.nl, see CREDITS.md)
const PLAYER_IMAGE = "assets/sprites/player.png";
const ENEMY_IMAGE = "assets/sprites/enemy.png";

// How long the soldier must stand still before we look up place details.
// 1000 milliseconds = 1 second.
const LOOKUP_DELAY_MS = 1000;

// =====================================================
// 1. Create the map with satellite imagery
// =====================================================

const map = L.map("map", {
  keyboard: false, // stops Leaflet using the arrow keys to slide the map (they move the soldier)
  maxZoom: 19, // the deepest zoom the map pictures have here (street level)
  scrollWheelZoom: "center", // zoom towards the middle of the screen, where the soldier is
  doubleClickZoom: "center",
  touchZoom: "center"
}).setView([START_LAT, START_LNG], START_ZOOM);

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
  attribution: "Labels &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
});
// City and neighbourhood names
const placeLabels = L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19
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
  this.blur(); // un-focus the button, so pressing Space attacks instead of clicking it again
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

// --- Camera follow ---
// When this is on, the map keeps the soldier in the middle of the screen.
const followButton = document.getElementById("follow-button");
let cameraFollows = true;

function setCameraFollow(on) {
  cameraFollows = on;
  followButton.textContent = on ? "Camera follow: on" : "Camera follow: off";
  if (on) {
    map.panTo(soldier.getLatLng());
  }
}

followButton.addEventListener("click", function () {
  this.blur();
  setCameraFollow(!cameraFollows);
});

// Dragging the map means you want to look around, so stop following
map.on("dragstart", function () {
  setCameraFollow(false);
});

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

// --- Soldier sprites ---
// Each soldier is built from a few pieces of HTML, drawn by style.css:
//   two boots (they step back and forth when walking or running),
//   the body picture, and a muzzle flash (only visible when attacking).
// The whole sprite is rotated to face the way the soldier is going.
// "extraHtml" lets enemies add a health bar above their heads.
function soldierIcon(imageFile, extraHtml) {
  return L.divIcon({
    className: "soldier-marker",
    iconSize: [0, 0], // the sprite centres itself on the spot using CSS
    html:
      '<div class="soldier">' +
      '<div class="soldier-sprite">' +
      '<div class="foot left"></div><div class="foot right"></div>' +
      '<img class="soldier-body" src="' + imageFile + '" alt="">' +
      '<div class="muzzle-flash"></div>' +
      "</div>" +
      (extraHtml || "") +
      "</div>"
  });
}

// Updates how a soldier looks:
//   action: "standing", "walking" or "running" (each has its own animation in style.css)
//   facing: the direction in degrees: 0 = east, 90 = south, 180 = west, -90 = north
function showSoldier(marker, action, facing) {
  const soldierDiv = marker.getElement().querySelector(".soldier");
  soldierDiv.classList.toggle("walking", action === "walking");
  soldierDiv.classList.toggle("running", action === "running");
  soldierDiv.querySelector(".soldier-sprite").style.transform = "rotate(" + facing + "deg)";
}

// Plays the attack animation (muzzle flash and recoil) for a moment
function playAttack(marker) {
  const soldierDiv = marker.getElement().querySelector(".soldier");
  soldierDiv.classList.add("attacking");
  setTimeout(function () {
    soldierDiv.classList.remove("attacking");
  }, 150);
}

// Turns a direction (metres north and east) into degrees for showSoldier.
// On a screen, "down" is positive, so north has to be flipped.
function facingDegrees(north, east) {
  return (Math.atan2(-north, east) * 180) / Math.PI;
}

// --- Sprite size ---
// Real soldiers would be tiny dots when zoomed out, and a fixed size would
// look silly when zoomed in. So the sprites grow a little with each zoom level,
// between a smallest and a largest size (in screen pixels).
function updateSpriteSize() {
  const size = Math.max(22, Math.min(48, 36 + (map.getZoom() - 18) * 12));
  // style.css reads this "--sprite-size" value to size every soldier
  document.documentElement.style.setProperty("--sprite-size", size + "px");
}
map.on("zoomend", updateSpriteSize);
updateSpriteSize();

// --- The player's soldier ---
// interactive: false means clicks go "through" the marker to the map,
// so you can click anywhere (even on a marker) to walk there.
const soldier = L.marker([START_LAT, START_LNG], {
  icon: soldierIcon(PLAYER_IMAGE),
  interactive: false,
  zIndexOffset: 1000 // draw the soldier on top of other markers
}).addTo(map);

let playerFacing = 0; // which way the player faces, in degrees (starts facing east)

const target = L.marker([TARGET_LAT, TARGET_LNG], { icon: emojiIcon("🎯"), interactive: false })
  .addTo(map)
  .bindTooltip(TARGET_NAME + " (" + TARGET_PLACE + ")", {
    permanent: true,
    direction: "right", // to the right, so the label doesn't hide the enemies to the west
    offset: [16, 0]
  });

// =====================================================
// 3. Distances, directions and positions
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

// One degree of latitude is about 111,320 metres everywhere on Earth.
// One degree of longitude gets shorter towards the poles, so we multiply
// by cos(latitude). This is accurate enough over a few km.
const METRES_PER_DEGREE = 111320;

// Returns how many metres north and east "to" is from "from"
function metresApart(from, to) {
  const metresPerDegreeLng = METRES_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180);
  return {
    north: (to.lat - from.lat) * METRES_PER_DEGREE,
    east: (to.lng - from.lng) * metresPerDegreeLng
  };
}

// =====================================================
// 3b. Buildings: walls that block the player, and paths around them
// =====================================================

// --- Flat "metres" coordinates ---
// Wall maths is much easier in metres than in latitude and longitude.
// So for buildings we measure every point as x metres east and y metres
// north of the soldier's starting spot.
const METRES_PER_DEGREE_LNG = METRES_PER_DEGREE * Math.cos((START_LAT * Math.PI) / 180);

function toMetres(latLng) {
  return {
    x: (latLng.lng - START_LNG) * METRES_PER_DEGREE_LNG,
    y: (latLng.lat - START_LAT) * METRES_PER_DEGREE
  };
}

function toLatLng(point) {
  return L.latLng(START_LAT + point.y / METRES_PER_DEGREE, START_LNG + point.x / METRES_PER_DEGREE_LNG);
}

// Each building becomes a list of corners in metres, plus a box around it.
// The box lets us skip buildings that are nowhere near the soldier.
const buildings = BUILDINGS.map(function (outline) {
  const corners = outline.map(function (point) {
    return toMetres(L.latLng(point));
  });
  const xs = corners.map(function (c) { return c.x; });
  const ys = corners.map(function (c) { return c.y; });
  return {
    corners: corners,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
});

// Is a point inside a building's outline? This is the classic "ray casting"
// test: imagine a line going right from the point, and count how many walls
// it crosses. An odd number means the point is inside.
function insideOutline(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i++) {
    const a = corners[i];
    const b = corners[j];
    if (a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// The closest point to "point" on the wall that runs from corner a to corner b
function closestPointOnWall(point, a, b) {
  const wallX = b.x - a.x;
  const wallY = b.y - a.y;
  const lengthSquared = wallX * wallX + wallY * wallY;
  // How far along the wall (0 = at a, 1 = at b), kept between the two ends
  let t = lengthSquared > 0 ? ((point.x - a.x) * wallX + (point.y - a.y) * wallY) / lengthSquared : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + wallX * t, y: a.y + wallY * t };
}

function distanceBetween(p, q) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

// Is this building in the way of a spot? (the spot is inside it,
// or closer than "margin" metres to one of its walls)
function buildingBlocks(building, point, margin) {
  // Quick check first: if the spot is outside the building's box, it's not blocked
  if (point.x < building.minX - margin || point.x > building.maxX + margin ||
      point.y < building.minY - margin || point.y > building.maxY + margin) {
    return false;
  }
  if (insideOutline(point, building.corners)) {
    return true;
  }
  const corners = building.corners;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i++) {
    if (distanceBetween(point, closestPointOnWall(point, corners[j], corners[i])) < margin) {
      return true;
    }
  }
  return false;
}

// Can the soldier stand here?
function isBlocked(point) {
  for (const building of buildings) {
    if (buildingBlocks(building, point, PLAYER_RADIUS)) {
      return true;
    }
  }
  return false;
}

// Finds the closest wall to a spot (used for sliding along walls)
function nearestWall(point) {
  let best = null;
  let bestDistance = Infinity;
  for (const building of buildings) {
    const corners = building.corners;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i++) {
      const distance = distanceBetween(point, closestPointOnWall(point, corners[j], corners[i]));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { a: corners[j], b: corners[i] };
      }
    }
  }
  return best;
}

// --- Moving with walls ---
// Tries to move from "from" by dx metres east and dy metres north.
// If a wall is in the way, the soldier slides along it instead of stopping dead.
function moveWithWalls(from, dx, dy) {
  const wanted = { x: from.x + dx, y: from.y + dy };

  // If the soldier is somehow already inside a wall, let them walk out
  if (!isBlocked(wanted) || isBlocked(from)) {
    return wanted;
  }

  // Keep only the part of the movement that goes along the wall we bumped into.
  // (Like pushing a chair diagonally into a wall: it scrapes along the wall.)
  const wall = nearestWall(wanted);
  const length = distanceBetween(wall.a, wall.b);
  const alongX = (wall.b.x - wall.a.x) / length; // a 1-metre arrow pointing along the wall
  const alongY = (wall.b.y - wall.a.y) / length;
  const slideDistance = dx * alongX + dy * alongY;
  const slid = { x: from.x + alongX * slideDistance, y: from.y + alongY * slideDistance };

  if (!isBlocked(slid)) {
    return slid;
  }
  return from; // squeezed into a corner: stay where we are
}

// --- The pathfinding grid ---
// For click-to-walk, the mission area is covered with squares (2 m across).
// Each square is marked as free or blocked by a building, once, when the game starts.
// A square counts as blocked if a wall is within 1 m of its centre, so that
// paths keep a little distance from walls.
const PATH_WALL_MARGIN = PLAYER_RADIUS + 0.5;
const gridOrigin = toMetres(L.latLng(BUILDINGS_AREA.south, BUILDINGS_AREA.west)); // bottom-left corner
const gridFarCorner = toMetres(L.latLng(BUILDINGS_AREA.north, BUILDINGS_AREA.east));
const gridColumns = Math.ceil((gridFarCorner.x - gridOrigin.x) / PATH_GRID_SIZE);
const gridRows = Math.ceil((gridFarCorner.y - gridOrigin.y) / PATH_GRID_SIZE);
// One number per square: 1 = blocked, 0 = free. (A Uint8Array is a fast list of small numbers.)
const blockedSquares = new Uint8Array(gridColumns * gridRows);

function squareCentre(column, row) {
  return {
    x: gridOrigin.x + (column + 0.5) * PATH_GRID_SIZE,
    y: gridOrigin.y + (row + 0.5) * PATH_GRID_SIZE
  };
}

function squareAt(point) {
  return {
    column: Math.floor((point.x - gridOrigin.x) / PATH_GRID_SIZE),
    row: Math.floor((point.y - gridOrigin.y) / PATH_GRID_SIZE)
  };
}

function insideGrid(square) {
  return square.column >= 0 && square.row >= 0 && square.column < gridColumns && square.row < gridRows;
}

function squareIsFree(column, row) {
  if (!insideGrid({ column: column, row: row })) {
    return false; // outside the mission area
  }
  return blockedSquares[row * gridColumns + column] === 0;
}

// Mark the squares. For speed, each building only checks the squares near it.
for (const building of buildings) {
  const first = squareAt({ x: building.minX - PATH_WALL_MARGIN, y: building.minY - PATH_WALL_MARGIN });
  const last = squareAt({ x: building.maxX + PATH_WALL_MARGIN, y: building.maxY + PATH_WALL_MARGIN });
  for (let row = Math.max(0, first.row); row <= Math.min(gridRows - 1, last.row); row++) {
    for (let column = Math.max(0, first.column); column <= Math.min(gridColumns - 1, last.column); column++) {
      if (buildingBlocks(building, squareCentre(column, row), PATH_WALL_MARGIN)) {
        blockedSquares[row * gridColumns + column] = 1;
      }
    }
  }
}

// Finds the nearest free square to a blocked one (e.g. when you click on a roof)
function nearestFreeSquare(square) {
  for (let distance = 1; distance <= 15; distance++) {
    for (let dRow = -distance; dRow <= distance; dRow++) {
      for (let dColumn = -distance; dColumn <= distance; dColumn++) {
        if (squareIsFree(square.column + dColumn, square.row + dRow)) {
          return { column: square.column + dColumn, row: square.row + dRow };
        }
      }
    }
  }
  return null;
}

// Can you walk in a straight line from p to q without hitting a blocked square?
// We check points every half-square along the line.
function clearLine(p, q) {
  const steps = Math.ceil(distanceBetween(p, q) / (PATH_GRID_SIZE / 2));
  for (let i = 1; i < steps; i++) {
    const square = squareAt({ x: p.x + ((q.x - p.x) * i) / steps, y: p.y + ((q.y - p.y) * i) / steps });
    if (!squareIsFree(square.column, square.row)) {
      return false;
    }
  }
  return true;
}

// A small "priority queue": it always hands back the item with the lowest
// score first. It's a "binary heap": a list kept in a special order so that
// adding and removing items stays fast, even with thousands of them.
function makePriorityQueue() {
  const items = [];
  const scores = [];
  return {
    size: function () {
      return items.length;
    },
    add: function (item, score) {
      items.push(item);
      scores.push(score);
      let i = items.length - 1;
      while (i > 0) { // move the new item up until its parent has a lower score
        const parent = (i - 1) >> 1;
        if (scores[parent] <= scores[i]) break;
        [items[i], items[parent]] = [items[parent], items[i]];
        [scores[i], scores[parent]] = [scores[parent], scores[i]];
        i = parent;
      }
    },
    takeLowest: function () {
      const lowest = items[0];
      const lastItem = items.pop();
      const lastScore = scores.pop();
      if (items.length > 0) {
        items[0] = lastItem;
        scores[0] = lastScore;
        let i = 0;
        while (true) { // move it down until both children have higher scores
          const left = 2 * i + 1;
          const right = left + 1;
          let smallest = i;
          if (left < items.length && scores[left] < scores[smallest]) smallest = left;
          if (right < items.length && scores[right] < scores[smallest]) smallest = right;
          if (smallest === i) break;
          [items[i], items[smallest]] = [items[smallest], items[i]];
          [scores[i], scores[smallest]] = [scores[smallest], scores[i]];
          i = smallest;
        }
      }
      return lowest;
    }
  };
}

// --- Finding a path (the "A*" method, pronounced "A star") ---
// A* explores squares outwards from the start, always trying the most
// promising square first: the one with the smallest
//   (distance walked so far) + (straight-line distance still to go).
// That way it heads towards the goal, but goes around buildings when it must.
// Returns a list of map positions to walk through, or null if there's no way.
function findPath(fromPosition, toPosition) {
  const start = toMetres(fromPosition);
  const goal = toMetres(toPosition);
  let startSquare = squareAt(start);
  let goalSquare = squareAt(goal);

  // The grid only covers the mission area. Outside it, return null
  // and the soldier simply walks straight (still sliding along walls).
  if (!insideGrid(startSquare) || !insideGrid(goalSquare)) {
    return null;
  }

  // If either end is on or right next to a building, use the nearest free square instead
  let goalIsExact = true;
  if (!squareIsFree(goalSquare.column, goalSquare.row)) {
    goalSquare = nearestFreeSquare(goalSquare);
    goalIsExact = false;
  }
  if (!squareIsFree(startSquare.column, startSquare.row)) {
    startSquare = nearestFreeSquare(startSquare);
  }
  if (!goalSquare || !startSquare) {
    return null;
  }

  const toIndex = function (column, row) { return row * gridColumns + column; };
  const startIndex = toIndex(startSquare.column, startSquare.row);
  const goalIndex = toIndex(goalSquare.column, goalSquare.row);

  // Straight-line estimate of the distance left, counting diagonal steps
  function estimate(column, row) {
    const dx = Math.abs(column - goalSquare.column);
    const dy = Math.abs(row - goalSquare.row);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  const walked = new Float32Array(gridColumns * gridRows).fill(Infinity); // best distance found to each square
  const cameFrom = new Int32Array(gridColumns * gridRows).fill(-1); // which square we reached it from
  const queue = makePriorityQueue();
  walked[startIndex] = 0;
  queue.add(startIndex, estimate(startSquare.column, startSquare.row));

  // The 8 neighbours of a square: 4 straight (cost 1) and 4 diagonal (cost 1.41)
  const neighbours = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];

  let found = false;
  while (queue.size() > 0) {
    const index = queue.takeLowest();
    if (index === goalIndex) {
      found = true;
      break;
    }
    const column = index % gridColumns;
    const row = Math.floor(index / gridColumns);

    for (const [dColumn, dRow, cost] of neighbours) {
      const nextColumn = column + dColumn;
      const nextRow = row + dRow;
      if (!squareIsFree(nextColumn, nextRow)) continue;
      // Don't cut diagonally across the corner of a building
      if (dColumn !== 0 && dRow !== 0 &&
          (!squareIsFree(column + dColumn, row) || !squareIsFree(column, row + dRow))) continue;

      const nextIndex = toIndex(nextColumn, nextRow);
      const newWalked = walked[index] + cost;
      if (newWalked < walked[nextIndex]) {
        walked[nextIndex] = newWalked;
        cameFrom[nextIndex] = index;
        queue.add(nextIndex, newWalked + estimate(nextColumn, nextRow));
      }
    }
  }
  if (!found) return null;

  // Follow the "came from" trail backwards, from the goal to the start
  const squares = [];
  for (let index = goalIndex; index !== -1; index = cameFrom[index]) {
    squares.unshift(squareCentre(index % gridColumns, Math.floor(index / gridColumns)));
  }
  if (goalIsExact) {
    squares[squares.length - 1] = goal; // finish exactly on the clicked spot
  }

  // Tidy the path: the grid makes zig-zags, so skip every point we can
  // see past. We only keep a corner when a building blocks the straight line.
  const path = [];
  let current = start;
  let i = 0;
  while (i < squares.length) {
    let furthest = i;
    while (furthest + 1 < squares.length && clearLine(current, squares[furthest + 1])) {
      furthest = furthest + 1;
    }
    path.push(squares[furthest]);
    current = squares[furthest];
    i = furthest + 1;
  }
  return path.map(toLatLng);
}

// =====================================================
// 4. The information panel
// =====================================================

const soldierPositionText = document.getElementById("soldier-position");
const targetInfoText = document.getElementById("target-info");
const locateStatusText = document.getElementById("locate-status");
const healthFill = document.getElementById("health-fill");
const healthText = document.getElementById("health-text");
const enemiesLeftText = document.getElementById("enemies-left");
const movementText = document.getElementById("movement-text");

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

function updateHealthDisplay() {
  const percent = Math.max(0, (playerHealth / PLAYER_MAX_HEALTH) * 100);
  healthFill.style.width = percent + "%";
  healthText.textContent = Math.ceil(Math.max(0, playerHealth));

  // Green when healthy, orange when hurt, red when in danger
  if (percent > 50) healthFill.style.background = "#43a047";
  else if (percent > 25) healthFill.style.background = "#fb8c00";
  else healthFill.style.background = "#e53935";
}

// =====================================================
// 5. Moving the player
// =====================================================

let playerHealth = PLAYER_MAX_HEALTH;
let gameState = "playing"; // "playing", "won" or "lost"

// Every kind of movement goes through this one function,
// so the panel is always kept up to date.
function moveSoldier(newPosition) {
  soldier.setLatLng(newPosition);
  updateInfoPanel();

  // Keep the camera centred on the soldier (unless camera follow is off)
  if (cameraFollows) {
    map.panTo(newPosition, { animate: false });
  }

  // Look up details about this place once the soldier stops (see section 9)
  scheduleLookup();
}

// --- Keyboard ---
// We remember which keys are being held down (arrows, and Shift for running).
// The game loop (section 10) moves the soldier for as long as a key is held.
const keysDown = {};

document.addEventListener("keydown", function (event) {
  if (event.key.startsWith("Arrow")) {
    event.preventDefault(); // stop the browser doing its own thing with the arrow keys
    keysDown[event.key] = true;
  } else if (event.key === "Shift") {
    keysDown.Shift = true;
  } else if (event.code === "Space") {
    event.preventDefault(); // stop Space from scrolling or clicking a button
    if (!event.repeat) {
      attack(); // holding Space down only attacks once
    }
  }
});

document.addEventListener("keyup", function (event) {
  keysDown[event.key] = false;
});

// If the window loses focus while a key is held, forget all keys,
// otherwise the soldier would keep walking by itself.
window.addEventListener("blur", function () {
  for (const key in keysDown) {
    keysDown[key] = false;
  }
});

// --- Click to walk ---
// Clicking finds a path around the buildings (see findPath in section 3b).
// walkPath is the list of points still to walk through; empty = not click-walking.
let walkPath = [];

// A dashed line on the map shows the path the soldier will take
const walkLine = L.polyline([], {
  color: "#ffe14d",
  weight: 3,
  dashArray: "6 6",
  opacity: 0.9,
  interactive: false
}).addTo(map);

map.on("click", function (event) {
  // If there's no path (e.g. outside the mission area), just head straight there
  walkPath = findPath(soldier.getLatLng(), event.latlng) || [event.latlng];
  walkLine.setLatLngs([soldier.getLatLng()].concat(walkPath));
});

function stopWalking() {
  walkPath = [];
  walkLine.setLatLngs([]);
}

// Called every frame by the game loop. "seconds" is the time since the
// last frame (about 1/60 of a second), so the speed is the same on every computer.
function movePlayer(seconds) {
  // Which way do the arrow keys point? (+1 / -1 in each direction)
  let north = 0;
  let east = 0;
  if (keysDown.ArrowUp) north = north + 1;
  if (keysDown.ArrowDown) north = north - 1;
  if (keysDown.ArrowRight) east = east + 1;
  if (keysDown.ArrowLeft) east = east - 1;

  const stepLength = currentSpeed() * seconds; // metres to move this frame

  if (north !== 0 || east !== 0) {
    stopWalking(); // using the keys cancels a click-walk
  } else if (walkPath.length > 0) {
    // No keys held, so head for the next point on the path
    const nextPoint = walkPath[0];
    const gap = metresApart(soldier.getLatLng(), nextPoint);
    if (Math.hypot(gap.north, gap.east) <= stepLength) {
      // Reached this point: step onto it, then aim for the next one
      moveSoldier(nextPoint);
      walkPath.shift();
      if (walkPath.length === 0) stopWalking();
      return;
    }
    north = gap.north;
    east = gap.east;
    walkLine.setLatLngs([soldier.getLatLng()].concat(walkPath));
  } else {
    // Nothing to do: the soldier stands still, still facing the same way
    showMovement("Standing", 0);
    showSoldier(soldier, "standing", playerFacing);
    return;
  }

  // Dividing by the arrow's length makes it 1 metre long, so moving
  // diagonally isn't faster than moving straight.
  const arrowLength = Math.hypot(north, east);
  const here = toMetres(soldier.getLatLng());
  const next = moveWithWalls(here, (east / arrowLength) * stepLength, (north / arrowLength) * stepLength);

  const movedEast = next.x - here.x;
  const movedNorth = next.y - here.y;
  if (Math.hypot(movedEast, movedNorth) < 0.0001) {
    // Completely blocked (pushing into a corner): stand still
    if (walkPath.length > 0) stopWalking();
    showMovement("Standing", 0);
    showSoldier(soldier, "standing", playerFacing);
    return;
  }

  // Face the way we actually moved (along the wall, if we slid),
  // and pick the walking or running animation
  playerFacing = facingDegrees(movedNorth, movedEast);
  const running = keysDown.Shift === true;
  showMovement(running ? "Running" : "Walking", currentSpeed());
  showSoldier(soldier, running ? "running" : "walking", playerFacing);
  moveSoldier(toLatLng(next));
}

// Speed in metres per second: running if Shift is held, slower in water
function currentSpeed() {
  let speed = keysDown.Shift ? RUN_SPEED : WALK_SPEED;
  if (inWater) {
    speed = speed * WATER_SPEED_FACTOR;
  }
  return speed;
}

// Shows e.g. "Running on land, 5.0 m/s" in the panel
function showMovement(action, speed) {
  let text = action + (inWater ? " in water" : " on land");
  if (speed > 0) {
    text = text + ", " + speed.toFixed(1) + " m/s";
  }
  movementText.textContent = text;
}

// --- Water slows the soldier down ---
// We use Open-Meteo's elevation data: the sea is at 0 metres, so any spot
// at 0 m or lower counts as water. We split the map into small squares
// (about 50 m across) and remember the answer for each square, so we only
// ask the internet once per square instead of 60 times a second.
const WATER_GRID_SIZE = 0.0005; // degrees of latitude/longitude (about 50 m)
const waterMemory = {}; // e.g. waterMemory["12230,27189"] = true (water) or false (land)
let inWater = false;

function checkWater() {
  const pos = soldier.getLatLng();
  const row = Math.round(pos.lat / WATER_GRID_SIZE);
  const column = Math.round(pos.lng / WATER_GRID_SIZE);
  const squareName = row + "," + column;

  if (waterMemory[squareName] === true || waterMemory[squareName] === false) {
    // We already know this square
    inWater = waterMemory[squareName];
  } else if (waterMemory[squareName] !== "checking") {
    // A new square: ask once, and keep the old answer until the reply arrives
    waterMemory[squareName] = "checking";
    const lat = (row * WATER_GRID_SIZE).toFixed(4);
    const lng = (column * WATER_GRID_SIZE).toFixed(4);
    fetchJson("https://api.open-meteo.com/v1/elevation?latitude=" + lat + "&longitude=" + lng)
      .then(function (data) {
        waterMemory[squareName] = data.elevation[0] <= 0;
      })
      .catch(function () {
        waterMemory[squareName] = false; // if the check fails, treat it as land
      });
  }
}

// =====================================================
// 6. Enemies
// =====================================================

// --- Patrol routes ---
// A route is a list of points along a real street (from patrol-routes.js).
// We also work out how far along the route each point is, which makes it
// easy to find the spot that is, say, 37 metres from the start.
function makeRoute(points) {
  const latLngs = points.map(function (point) {
    return L.latLng(point);
  });
  const distances = [0]; // distances[i] = metres from the start to point i
  for (let i = 1; i < latLngs.length; i++) {
    distances.push(distances[i - 1] + map.distance(latLngs[i - 1], latLngs[i]));
  }
  return { points: latLngs, distances: distances, length: distances[distances.length - 1] };
}

// Finds the spot a number of metres along a route.
// Also returns the two route points either side, so we know which way the street goes.
function pointOnRoute(route, metresAlong) {
  // Find the piece of street (between point i-1 and point i) that contains this distance
  let i = 1;
  while (i < route.points.length - 1 && route.distances[i] < metresAlong) {
    i = i + 1;
  }
  const before = route.points[i - 1];
  const after = route.points[i];
  const pieceLength = route.distances[i] - route.distances[i - 1];
  const t = pieceLength > 0 ? (metresAlong - route.distances[i - 1]) / pieceLength : 0;

  return {
    position: L.latLng(before.lat + (after.lat - before.lat) * t, before.lng + (after.lng - before.lng) * t),
    before: before,
    after: after
  };
}

// --- Create the enemies ---
const enemyHealthBar = '<div class="enemy-health"><div class="enemy-health-fill"></div></div>';

const enemies = [];
for (const patrol of PATROL_ROUTES) {
  const route = makeRoute(patrol.points);
  const enemy = {
    route: route,
    metresAlong: patrol.startAt * route.length, // how far along the route the enemy is
    direction: 1, // 1 = walking forwards along the route, -1 = walking back
    facing: 0,
    lastShotTime: 0,
    health: ENEMY_MAX_HEALTH,
    alive: true
  };
  const position = pointOnRoute(route, enemy.metresAlong).position;
  enemy.marker = L.marker(position, {
    icon: soldierIcon(ENEMY_IMAGE, enemyHealthBar),
    interactive: false
  }).addTo(map);

  // A faint red circle shows how close is too close
  enemy.dangerZone = L.circle(position, {
    radius: ENEMY_DANGER_RANGE,
    color: "#e53935",
    weight: 1,
    fillOpacity: 0.1,
    interactive: false
  }).addTo(map);

  enemies.push(enemy);
}

function enemiesAlive() {
  return enemies.filter(function (enemy) {
    return enemy.alive;
  });
}

// Called every frame. If the player is close, an enemy stops, turns to face
// them and fires. Otherwise it takes a small step along its street,
// turning around when it reaches either end of its route.
function moveEnemies(seconds) {
  const now = performance.now();

  for (const enemy of enemiesAlive()) {
    const enemyPos = enemy.marker.getLatLng();

    if (map.distance(enemyPos, soldier.getLatLng()) < ENEMY_DANGER_RANGE) {
      // Player spotted: stand still, aim at the player and fire every so often
      const gap = metresApart(enemyPos, soldier.getLatLng());
      enemy.facing = facingDegrees(gap.north, gap.east);
      showSoldier(enemy.marker, "standing", enemy.facing);
      if (now - enemy.lastShotTime > ENEMY_SHOT_INTERVAL_MS) {
        playAttack(enemy.marker);
        enemy.lastShotTime = now;
      }
      continue; // go on to the next enemy
    }

    // Patrol: step along the route
    enemy.metresAlong = enemy.metresAlong + enemy.direction * ENEMY_SPEED * seconds;
    if (enemy.metresAlong >= enemy.route.length) {
      enemy.metresAlong = enemy.route.length;
      enemy.direction = -1; // reached the end of the route: turn around
    } else if (enemy.metresAlong <= 0) {
      enemy.metresAlong = 0;
      enemy.direction = 1; // reached the start of the route: turn around
    }

    // Face along the street, in the direction of travel
    const spot = pointOnRoute(enemy.route, enemy.metresAlong);
    const street = metresApart(spot.before, spot.after);
    enemy.facing = facingDegrees(street.north * enemy.direction, street.east * enemy.direction);

    enemy.marker.setLatLng(spot.position);
    enemy.dangerZone.setLatLng(spot.position);
    showSoldier(enemy.marker, "walking", enemy.facing);
  }
}

// Called every frame: the player loses health for each enemy that is too close
function hurtPlayerIfNearEnemies(seconds) {
  let enemiesTooClose = 0;
  for (const enemy of enemiesAlive()) {
    if (map.distance(soldier.getLatLng(), enemy.marker.getLatLng()) < ENEMY_DANGER_RANGE) {
      enemiesTooClose = enemiesTooClose + 1;
    }
  }

  // Make the soldier glow red while being hurt
  soldier.getElement().classList.toggle("hurt", enemiesTooClose > 0);

  if (enemiesTooClose > 0) {
    playerHealth = playerHealth - ENEMY_DAMAGE_PER_SECOND * enemiesTooClose * seconds;
    updateHealthDisplay();
    if (playerHealth <= 0) {
      endMission(false);
    }
  }
}

// --- Attacking (Space) ---
let lastAttackTime = 0;

function attack() {
  if (gameState !== "playing") return;

  // Don't allow attacks faster than the cooldown
  const now = performance.now();
  if (now - lastAttackTime < ATTACK_COOLDOWN_MS) return;
  lastAttackTime = now;

  // Turn to face the closest enemy within reach (if there is one)
  let closestEnemy = null;
  let closestDistance = ATTACK_RANGE;
  for (const enemy of enemiesAlive()) {
    const distance = map.distance(soldier.getLatLng(), enemy.marker.getLatLng());
    if (distance <= closestDistance) {
      closestEnemy = enemy;
      closestDistance = distance;
    }
  }
  if (closestEnemy) {
    const gap = metresApart(soldier.getLatLng(), closestEnemy.marker.getLatLng());
    playerFacing = facingDegrees(gap.north, gap.east);
    showSoldier(soldier, "standing", playerFacing);
  }

  playAttack(soldier);
  showAttackFlash();

  for (const enemy of enemiesAlive()) {
    if (map.distance(soldier.getLatLng(), enemy.marker.getLatLng()) <= ATTACK_RANGE) {
      enemy.health = enemy.health - ATTACK_DAMAGE;

      // Shrink the enemy's little health bar
      const fill = enemy.marker.getElement().querySelector(".enemy-health-fill");
      fill.style.width = Math.max(0, enemy.health) + "%";

      if (enemy.health <= 0) {
        // Defeated: remove the enemy and its danger circle from the map
        enemy.alive = false;
        enemy.marker.remove();
        enemy.dangerZone.remove();
      }
    }
  }
  enemiesLeftText.textContent = enemiesAlive().length;
}

// A quick yellow circle shows the reach of the attack
function showAttackFlash() {
  const flash = L.circle(soldier.getLatLng(), {
    radius: ATTACK_RANGE,
    color: "#ffeb3b",
    weight: 2,
    fillOpacity: 0.25,
    interactive: false
  }).addTo(map);

  setTimeout(function () {
    flash.remove();
  }, 150); // remove it after 0.15 seconds
}

// =====================================================
// 7. Winning, losing and restarting
// =====================================================

function checkMissionComplete() {
  if (map.distance(soldier.getLatLng(), target.getLatLng()) <= TARGET_REACHED_DISTANCE) {
    endMission(true);
  }
}

function endMission(won) {
  if (gameState !== "playing") return; // the mission has already ended

  gameState = won ? "won" : "lost";
  stopWalking();

  const defeated = enemies.length - enemiesAlive().length;
  if (won) {
    document.getElementById("game-over-title").textContent = "Mission complete";
    document.getElementById("game-over-text").textContent =
      "You reached " + TARGET_NAME + " with " + Math.ceil(playerHealth) + " health left and defeated " +
      defeated + " of " + enemies.length + " enemies.";
  } else {
    const metresLeft = map.distance(soldier.getLatLng(), target.getLatLng());
    document.getElementById("game-over-title").textContent = "Mission failed";
    document.getElementById("game-over-text").textContent =
      "You were defeated " + formatDistance(metresLeft) + " from " + TARGET_NAME + ".";
  }

  document.getElementById("game-over").hidden = false; // show the message box
}

// Restarting simply reloads the page, which puts everything back to the start
document.getElementById("restart-button").addEventListener("click", function () {
  location.reload();
});

// =====================================================
// 8. "Locate me" button: show the player's real location
// =====================================================

let myLocationMarker = null; // the blue dot, created the first time we find you

document.getElementById("locate-button").addEventListener("click", function () {
  this.blur(); // un-focus the button, so pressing Space attacks instead of clicking it again

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

  setCameraFollow(false); // otherwise the camera would jump back to the soldier
  map.setView([lat, lng], 15);
  locateStatusText.textContent =
    "You: " + lat.toFixed(5) + ", " + lng.toFixed(5) + " (±" + Math.round(accuracy) + " m)";
}

function showLocationError(error) {
  locateStatusText.textContent = "Couldn't get your location: " + error.message;
}

// =====================================================
// 9. Place details: elevation, weather, climate, soil,
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

// =====================================================
// 10. Start the game
// =====================================================

// The game loop runs about 60 times per second. Each time ("frame") it
// moves everything a little and checks whether the mission has ended.
let lastFrameTime = performance.now();

function gameLoop(now) {
  // Seconds since the last frame. Capped at 0.1 so that if the browser tab
  // was hidden for a while, nothing jumps a huge distance when you come back.
  const seconds = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  if (gameState === "playing") {
    checkWater();
    movePlayer(seconds);
    moveEnemies(seconds);
    hurtPlayerIfNearEnemies(seconds);
    checkMissionComplete();
  }

  requestAnimationFrame(gameLoop); // ask the browser to run this again next frame
}

updateInfoPanel();
updateHealthDisplay();
lookUpPlace();
requestAnimationFrame(gameLoop);
