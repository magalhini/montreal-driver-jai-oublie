import type { CityModel } from '../../world/RoadGraph';

/**
 * Downtown's relief, at game scale (junction heights in meters; the terrain relaxes them to `MAX_GRADE`).
 *
 * The river, the canal, Griffintown, the Old Port and Vieux-Montréal stay low and flat (water edges, quay
 * railings, the basilica and the cobbles all want it). From Saint-Jacques the city climbs in terraces, the
 * old shorelines: the Beaver Hall slope up to de La Gauchetière and René-Lévesque, Sainte-Catherine, and
 * Sherbrooke on top, highest toward the mountain on the west side and with a smaller rise behind the Quartier
 * latin. On the hill every junction is also pushed up or down a few meters in a checkerboard, so the blocks
 * between them roll: most of them have a crest a fast car leaves the ground over.
 */
export const RELIEF = {
  /** Terrace height of each row (Sherbrooke first, the last quay last). */
  rows: [30, 26, 21, 18.5, 15, 11, 6.5, 3.5, 1.2, 1.2, 0, 0, 0, 0, 0, 0],
  /** Extra toward the mountain (north-west corner) and behind the Quartier latin (north-east). */
  mountain: 8,
  latin: 4,
  /** Checkerboard push (m) on the hill, faded out toward Notre-Dame. */
  roll: 6.5,
  rollRows: [1, 1, 1, 1, 1, 1, 0.8, 0.45, 0, 0, 0, 0, 0, 0, 0, 0],
};

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function montrealRelief(city: CityModel): number[] {
  const R = RELIEF;
  const nx = city.nx;
  const nz = city.nz;
  const h = new Array<number>(nx * nz).fill(0);
  for (let j = 0; j < nz; j++) {
    const row = R.rows[Math.min(j, R.rows.length - 1)];
    const roll = R.rollRows[Math.min(j, R.rollRows.length - 1)];
    const up = smooth(1 - j / 6);
    for (let i = 0; i < nx; i++) {
      const west = smooth(1 - i / (nx * 0.55));
      const east = smooth((i - nx * 0.7) / (nx * 0.25));
      const lift = up * (R.mountain * west + R.latin * east);
      // Corners and the outer columns roll less: the edge of the map stays readable
      const edge = i === 0 || i === nx - 1 || j === 0 ? 0.5 : 1;
      const push = ((i + j) % 2 === 0 ? 1 : -1) * R.roll * roll * edge;
      h[j * nx + i] = Math.max(0, row + lift + push);
    }
  }
  return h;
}
