# Credits

TerraShift (*See how the land changes*) is built from free code, map pictures and data made by other people. Thank you!

## Satellite images

**Sentinel-2** images: contains modified Copernicus Sentinel data, processed by ESA.
Copernicus Sentinel data is free to use, including commercially, under the
[Legal Notice on the use of Copernicus Sentinel Data](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice).

Found, read and displayed through **[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/)**
(its STAC catalogue, data tile service and image files, read with its free anonymous token), used without an API key.

## Elevation (the Terrain tab)

**Copernicus DEM GLO-30**, heights every 30 m: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018,
provided under COPERNICUS by the European Union and ESA; all rights reserved. Free to use, with this credit, under the
[Copernicus DEM licence](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).
Read through **[Microsoft Planetary Computer](https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30)**, which gives
a free signed address for each file, used without an API key. The credit is also shown in the Terrain tab and in the PDF report.

## Code

**[Leaflet](https://leafletjs.com/)** 1.9.4, the interactive map library.
License: BSD 2-Clause. Loaded from unpkg.com.

**[geotiff.js](https://geotiffjs.github.io/)** 3.0.5, reads the satellite image files.
License: MIT. Loaded from jsDelivr.

**[proj4js](https://github.com/proj4js/proj4js)** 2.15.0, converts map coordinates.
License: MIT. Loaded from cdnjs.

**[jsPDF](https://github.com/parallax/jsPDF)** 4.2.1, makes the PDF report in the browser.
License: MIT. Loaded from cdnjs.

## Testing (not part of the website)

**[Puppeteer](https://pptr.dev/)**, which runs the browser tests in headless Chrome.
License: Apache 2.0. Installed with `npm install`.

The tests use [Node.js](https://nodejs.org/)'s built-in test runner and run on [GitHub Actions](https://github.com/features/actions).
The release badge in the README comes from [Shields.io](https://shields.io/).

## Map pictures

The background satellite imagery, street labels, place labels and the street map come from **Esri** (ArcGIS Online basemaps), used without an API key. The required credits are shown in the bottom-right corner of the map.
Sources: Esri, Maxar, Earthstar Geographics, HERE, Garmin, USGS, © OpenStreetMap contributors, and the GIS user community.

## Data in the Place details tab

| Data | Source | License |
|---|---|---|
| Elevation, weather, climate | [Open-Meteo](https://open-meteo.com/) | CC BY 4.0 |
| Soil type | [ISRIC SoilGrids](https://soilgrids.org/) | CC BY 4.0 |
| Land cover | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via the Overpass API | [ODbL](https://opendatacommons.org/licenses/odbl/) |
| Wildlife records | [GBIF.org](https://www.gbif.org/) | Records are CC0, CC BY or CC BY-NC, set by each dataset's publisher |

## Place search

The search box uses **[Nominatim](https://nominatim.org/)**, run by the OpenStreetMap Foundation, following its
[usage policy](https://operations.osmfoundation.org/policies/nominatim/): searches only when you press Search,
at most one a second, answers kept instead of asked for again, and the credit shown under the box.
Place data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).
