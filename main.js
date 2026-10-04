// ----- 1. Where the map starts -----
// Abu Dhabi, UAE. Latitude first, then longitude.
const START_LAT = 24.4539;
const START_LNG = 54.3773;
const START_ZOOM = 11; // 1 = whole world, 19 = individual buildings

// ----- 2. Create the map inside <div id="map"> -----
const map = L.map("map").setView([START_LAT, START_LNG], START_ZOOM);

// ----- 3. Add the satellite imagery -----
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

// ----- 4. Show latitude and longitude when the map is clicked -----
map.on("click", function (event) {
  // event.latlng holds the position of the click
  const lat = event.latlng.lat.toFixed(5); // round to 5 decimal places (about 1 metre)
  const lng = event.latlng.lng.toFixed(5);

  // Open a small popup at the spot that was clicked
  L.popup()
    .setLatLng(event.latlng)
    .setContent("Latitude: " + lat + "<br>Longitude: " + lng)
    .openOn(map);
});
