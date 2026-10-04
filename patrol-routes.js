// Enemy patrol routes, taken from OpenStreetMap road data.
// © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
// Downloaded on 2026-10-04 with the Overpass API. Each route is a stretch
// (about 140 m) of one real street or path, as a list of [latitude, longitude] points.
// Enemies walk along the points in order, then turn around and walk back.
const PATROL_ROUTES = [
  {
    name: "Zayed The First Street",
    osmWay: 398717139, // see https://www.openstreetmap.org/way/398717139
    startAt: 0.5, // where the enemy begins: 0 = first point, 1 = last point
    points: [
      [24.468572, 54.341941],
      [24.468618, 54.341997],
      [24.468728, 54.342132],
      [24.468884, 54.342323],
      [24.469194, 54.342702],
      [24.469333, 54.342879]
    ]
  },
  {
    name: "pavement beside Al Khaleej Al Arabi Street",
    osmWay: 1029631803, // see https://www.openstreetmap.org/way/1029631803
    startAt: 0.0, // where the enemy begins: 0 = first point, 1 = last point
    points: [
      [24.469642, 54.343626],
      [24.469613, 54.343630],
      [24.469581, 54.343636],
      [24.469533, 54.343650],
      [24.468961, 54.343880],
      [24.468826, 54.343933],
      [24.468736, 54.343978],
      [24.468621, 54.344054],
      [24.468512, 54.344142],
      [24.468492, 54.344160]
    ]
  },
  {
    name: "footpath in Khalidiya Garden",
    osmWay: 91663023, // see https://www.openstreetmap.org/way/91663023
    startAt: 1.0, // where the enemy begins: 0 = first point, 1 = last point
    points: [
      [24.468391, 54.345272],
      [24.468393, 54.345238],
      [24.468542, 54.345091],
      [24.468654, 54.344980],
      [24.468813, 54.344993],
      [24.469031, 54.345010],
      [24.469020, 54.345240],
      [24.469012, 54.345404],
      [24.468909, 54.345505]
    ]
  }
];
