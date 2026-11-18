import type { DistrictType, StreetClass, StreetName } from '../../types';

/**
 * The street grid, rotated so it lies on the game's axes.
 * +X runs southwest to northeast along René-Lévesque (toward the clock tower).
 * +Z runs inland to the river. Curves (the canal, the port shore, de la Commune) are snapped straight.
 * Positions are meters in that frame, before the generator centers them on the origin.
 * Heights are [low, high] meters per block, from measured buildings where OSM had them and from the
 * district otherwise. The skyline step-down toward the river is the part the screenshots show.
 */

/** Cross streets, west to east. */
export const X_RAW = [
  -1397, // Guy
  -1139, // Lucien-L'Allier
  -1020, // de la Montagne
  -905, // Drummond
  -728, // Peel
  -617, // Metcalfe
  -452, // McGill College
  -346, // Robert-Bourassa
  -210, // University
  -36, // McGill
  99, // Saint-Pierre
  289, // Saint-François-Xavier
  444, // Saint-Urbain
  594, // Saint-Laurent
  761, // De Bullion
  972, // Sanguinet
  1096, // Saint-Denis
  1222, // Berri
  1333, // Saint-Hubert
];

/** Avenues and streets, mountain to river. */
export const Z_RAW = [
  -1275, // Sherbrooke
  -1097, // De Maisonneuve
  -919, // Sainte-Catherine
  -833, // Cathcart
  -687, // René-Lévesque
  -478, // de La Gauchetière
  -339, // Saint-Antoine
  -201, // Saint-Jacques
  -45, // Notre-Dame
  80, // Saint-Paul
  185, // William (de la Commune east of McGill, along the Old Port)
  318, // Ottawa
  484, // Wellington
  564, // south bank of the canal
  720, // basin road
  900, // last quay, then the St. Lawrence
];

/** Names on the blades and the map, one per entry of `X_RAW`. */
const X_NAMES: StreetName[] = [
  { generic: 'Rue', name: 'Guy' },
  { generic: 'Rue', name: "Lucien-L'Allier" },
  { generic: 'Rue', name: 'de la Montagne' },
  { generic: 'Rue', name: 'Drummond' },
  { generic: 'Rue', name: 'Peel' },
  { generic: 'Rue', name: 'Metcalfe' },
  { generic: 'Avenue', name: 'McGill College' },
  { generic: 'Boulevard', name: 'Robert-Bourassa' },
  { generic: 'Rue', name: 'University' },
  { generic: 'Rue', name: 'McGill' },
  { generic: 'Rue', name: 'Saint-Pierre' },
  { generic: 'Rue', name: 'Saint-François-Xavier' },
  { generic: 'Rue', name: 'Saint-Urbain' },
  { generic: 'Boulevard', name: 'Saint-Laurent' },
  { generic: 'Rue', name: 'De Bullion' },
  { generic: 'Rue', name: 'Sanguinet' },
  { generic: 'Rue', name: 'Saint-Denis' },
  { generic: 'Rue', name: 'Berri' },
  { generic: 'Rue', name: 'Saint-Hubert' },
];

/** One per entry of `Z_RAW`; the quay roads south of the canal have no posted name. */
const Z_NAMES: (StreetName | null)[] = [
  { generic: 'Rue', name: 'Sherbrooke' },
  { generic: 'Boulevard', name: 'De Maisonneuve' },
  { generic: 'Rue', name: 'Sainte-Catherine' },
  { generic: 'Rue', name: 'Cathcart' },
  { generic: 'Boulevard', name: 'René-Lévesque' },
  { generic: 'Rue', name: 'De La Gauchetière' },
  { generic: 'Rue', name: 'Saint-Antoine' },
  { generic: 'Rue', name: 'Saint-Jacques' },
  { generic: 'Rue', name: 'Notre-Dame' },
  { generic: 'Rue', name: 'Saint-Paul' },
  { generic: 'Rue', name: 'William' },
  { generic: 'Rue', name: 'Ottawa' },
  { generic: 'Rue', name: 'Wellington' },
  { generic: 'Rue', name: 'Saint-Patrick' },
  null,
  null,
];
const COMMUNE_NAME: StreetName = { generic: 'Rue', name: 'de la Commune' };

export const COLS = X_RAW.length - 1;
export const ROWS = Z_RAW.length - 1;

/** Column index of a cross-street that is a boulevard. */
const AVENUE_X = new Set([4, 7, 13, 17]); // Peel, Robert-Bourassa, Saint-Laurent, Berri
/** Row index of an east-west boulevard. */
const AVENUE_Z = new Set([0, 2, 4, 8, 12]); // Sherbrooke, Sainte-Catherine, René-Lévesque, Notre-Dame, Wellington

export const avenueX = (i: number): boolean => AVENUE_X.has(i);
export const avenueZ = (j: number): boolean => AVENUE_Z.has(j);

/** Shape of each street class (PRD 4.2). Widths in meters; the limit is what `RoadEdge.speedLimit` gets. */
export const STREET_CLASSES: Record<StreetClass, { lanesPerDir: number; laneWidth: number; parking: number; median: number; limitKmh: number }> = {
  boulevard: { lanesPerDir: 3, laneWidth: 3.5, parking: 2.4, median: 0.25, limitKmh: 50 },
  street: { lanesPerDir: 1, laneWidth: 3.6, parking: 2.3, median: 0, limitKmh: 40 },
  cobble: { lanesPerDir: 1, laneWidth: 3.1, parking: 0, median: 0, limitKmh: 30 },
};

/** Curb-to-curb width of a street class. */
export function classWidth(c: StreetClass): number {
  const k = STREET_CLASSES[c];
  return 2 * (k.median + k.lanesPerDir * k.laneWidth + k.parking);
}

/** First column of Vieux-Montréal (McGill): Saint-Paul and de la Commune are setts from here east. */
const OLD_CITY_I = 9;
/** Row of Saint-Paul, and of William, which is de la Commune once it reaches the old city. */
const SAINT_PAUL = 9;
const COMMUNE = 10;
/** Sainte-Catherine through the Quartier latin, Saint-Laurent to Berri: the one paved stretch off the old city. */
const SAINTE_CATHERINE = 2;
const LATIN_I0 = 13;
const LATIN_I1 = 17;

/** Class of the east-west road on row j between columns i and i + 1. */
export function rowClass(i: number, j: number): StreetClass {
  if ((j === SAINT_PAUL || j === COMMUNE) && i >= OLD_CITY_I) return 'cobble';
  if (j === SAINTE_CATHERINE && i >= LATIN_I0 && i < LATIN_I1) return 'cobble';
  return avenueZ(j) ? 'boulevard' : 'street';
}

/** Name of the east-west road on row j between columns i and i + 1 (William is de la Commune in the old city). */
export function rowName(i: number, j: number): StreetName | null {
  if (j === COMMUNE && i >= OLD_CITY_I) return COMMUNE_NAME;
  return Z_NAMES[j] ?? null;
}

/** Name of the north-south road on column i. */
export function colName(i: number): StreetName | null {
  return X_NAMES[i] ?? null;
}

/**
 * Junction control (PRD 5.8): lights where a boulevard crosses, all-way ARRÊT where only streets and cobbles
 * meet, with about one such crossing in four keeping its lights. `h` is a stable hash of the junction, 0..1.
 */
export function junctionControl(classes: StreetClass[], h: number): 'signal' | 'stop' | 'none' {
  if (classes.length < 3) return 'none';
  if (classes.includes('boulevard')) return 'signal';
  return h < 0.25 ? 'signal' : 'stop';
}

/** Class of the north-south road on column i between rows j and j + 1. */
export function colClass(i: number, _j: number): StreetClass {
  return avenueX(i) ? 'boulevard' : 'street';
}

/** Block row the Lachine Canal cuts through (between Wellington and the south bank). */
export const CANAL_ROW = 12;

/** Centre Bell: the low hall between Lucien-L'Allier and de la Montagne, south of René-Lévesque. */
export const ARENA = { i: 1, j: 4 };
/** Farine Five Roses and the Peel basin sheds, south of the canal. */
export const SILOS = { i: 4, j: 13 };
/**
 * Notre-Dame Basilica: south side of Notre-Dame, Saint-François-Xavier to Saint-Urbain (standing in for
 * Saint-Sulpice), its front on Place d'Armes across the street.
 */
export const BASILICA = { i: 11, j: 8 };

/**
 * Pedestrian squares with a fountain, surrounded by streets. Place d'Armes runs from Saint-Jacques to Notre-Dame,
 * facing the basilica across the street, with buildings either side; the Griffintown square is where the old
 * dispatch yard stood (Drummond to Peel, William to Ottawa). `keep`: meters of street wall left standing along
 * the block's north edge; `width`: the square's width, centered (the rest of the block keeps its buildings).
 */
export const SQUARES: { i: number; j: number; name?: string; monument: boolean; keep: number; width?: number }[] = [
  { i: 11, j: 7, name: "Place d'Armes", monument: true, keep: 0, width: 84 },
  { i: 3, j: 10, monument: false, keep: 34 },
];

export const isSquare = (i: number, j: number) => SQUARES.find((s) => s.i === i && s.j === j);

/** The session starts on the street by the Griffintown square, west of downtown (PRD 9). */
export const START = { i: 3, j: 10 };

/**
 * Parks big enough to be a whole block. Keys are "column,row".
 * Dorchester and Place du Canada, Phillips, Victoria, Chaboillez, d'Youville,
 * Champ-de-Mars, Faubourg Sainte-Anne, Jean-Paul-Riopelle, Frères-Charon.
 */
export const PARKS = new Set(['4,3', '4,4', '8,2', '8,6', '4,7', '9,9', '14,6', '2,11', '9,5', '8,11']);

export const isPark = (i: number, j: number): boolean => PARKS.has(`${i},${j}`);

export function districtAt(i: number, j: number): DistrictType {
  if (j >= CANAL_ROW) return 'harbor';
  if (j >= 8 && i >= 9) return 'oldtown'; // Vieux-Montréal
  if (j >= 8) return 'residential'; // Griffintown, Cité du Multimédia
  if (i >= 13 && j >= 2 && j <= 7) return 'oldtown'; // Chinatown and the latin quarter
  if (i <= 1) return 'residential'; // west of the arena: Shaughnessy, the station
  if (i >= 2 && i <= 10 && j >= 1 && j <= 7) return 'downtown';
  if (j === 0 && i >= 6 && i <= 10) return 'downtown';
  return 'residential';
}

/** [low, high] meters for block column i, row j. */
const HEIGHTS: readonly (readonly [number, number])[][] = [
  [[10, 28], [10, 28], [14, 30], [14, 30], [14, 30], [14, 30], [24, 70], [24, 70], [66, 70], [54, 102], [24, 70], [14, 30], [14, 30], [10, 19], [6, 10], [14, 30], [14, 30], [14, 30]],
  [[10, 28], [10, 28], [32, 110], [32, 110], [32, 110], [32, 110], [57, 158], [35, 146], [31, 35], [10, 32], [62, 66], [14, 30], [42, 67], [10, 32], [16, 42], [14, 30], [14, 30], [14, 30]],
  [[10, 28], [10, 28], [32, 110], [32, 110], [32, 110], [10, 32], [31, 35], [28, 32], [16, 35], [22, 26], [10, 32], [14, 30], [14, 30], [18, 22], [12, 32], [22, 26], [12, 32], [12, 32]],
  [[10, 16], [10, 16], [32, 110], [22, 36], [32, 110], [68, 122], [184, 188], [44, 48], [32, 45], [22, 36], [36, 64], [14, 30], [14, 30], [34, 38], [25, 29], [23, 48], [12, 32], [12, 32]],
  [[6, 10], [28, 34], [32, 110], [102, 199], [32, 110], [66, 70], [34, 38], [42, 134], [54, 80], [16, 32], [10, 32], [13, 32], [10, 26], [10, 16], [13, 32], [12, 32], [22, 26], [12, 32]],
  [[9, 13], [10, 16], [164, 168], [131, 135], [113, 139], [32, 110], [32, 110], [86, 90], [29, 90], [121, 125], [32, 110], [14, 30], [14, 30], [12, 32], [12, 32], [38, 42], [12, 32], [12, 32]],
  [[9, 13], [10, 28], [41, 45], [16, 32], [18, 22], [10, 32], [32, 110], [32, 110], [32, 110], [29, 83], [38, 67], [38, 42], [14, 30], [12, 32], [12, 32], [12, 32], [9, 13], [12, 32]],
  [[10, 16], [22, 26], [54, 70], [32, 110], [32, 110], [178, 182], [32, 110], [32, 110], [16, 32], [16, 32], [31, 35], [26, 40], [28, 32], [12, 32], [12, 32], [12, 32], [12, 32], [12, 32]],
  [[12, 32], [10, 19], [26, 32], [34, 38], [19, 28], [28, 32], [12, 32], [16, 32], [50, 54], [32, 38], [18, 22], [9, 13], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22]],
  [[12, 32], [9, 13], [21, 25], [28, 32], [21, 40], [26, 32], [12, 32], [13, 29], [26, 32], [11, 22], [11, 22], [11, 22], [11, 22], [6, 10], [11, 22], [11, 22], [11, 22], [11, 22]],
  [[12, 32], [12, 32], [25, 29], [6, 29], [21, 32], [28, 32], [12, 32], [12, 32], [26, 32], [22, 26], [9, 13], [11, 22], [11, 22], [6, 10], [11, 22], [11, 22], [11, 22], [11, 22]],
  [[12, 32], [12, 32], [10, 26], [38, 66], [63, 67], [22, 36], [12, 32], [19, 33], [19, 32], [13, 32], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22], [11, 22]],
  [[8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12], [8, 12]],
  [[8, 16], [8, 16], [8, 16], [8, 42], [8, 42], [8, 42], [9, 13], [9, 13], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16]],
  [[8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16], [8, 16]],
];

export function heightOf(i: number, j: number): readonly [number, number] {
  const row = HEIGHTS[j];
  if (!row || row.length !== COLS || HEIGHTS.length !== ROWS) throw new Error('Montreal height grid does not match the streets');
  return row[i] ?? [12, 24];
}
