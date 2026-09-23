/**
 * The auto-loader.
 *
 * Not a search — a packer. It works the way a person who is good at this works: put
 * the plates in the tine rows first because only the tines will hold them upright,
 * stand the trays and boards in there too, drop the cutlery in the basket, and then
 * fit the pots and bowls face-down into whatever floor is left, biggest first.
 *
 * It has to satisfy exactly the rules the machine applies at the end of the cycle, so
 * it obeys them by construction: everything lands in the rack it belongs in, every
 * open vessel goes opening-down, nothing overlaps anything else (so nothing shades
 * anything else), and every item is checked against its rack's headroom before it is
 * committed. Where a level genuinely will not fit, it says so rather than pretending.
 */
import * as THREE from 'three';
import { DISHES, createDish } from './dishes.js';
import { RACKS } from './dishwasher.js';

const GAP = 0.011;          // breathing room — water has to reach between them
const CELL = 0.008;         // packing grid resolution

/** Items that are flat and round (or flat and rectangular) and stand in a tine row. */
const STANDS_IN_TINES = new Set([
  'dinner-plate', 'side-plate', 'saucer', 'platter', 'casserole-lid',
  'baking-tray', 'cutting-board',
]);

/* ------------------------------------------------------------------ *
 *  A rack deck, as an occupancy grid
 * ------------------------------------------------------------------ */
class Deck {
  constructor(width, depth) {
    this.w = width;
    this.d = depth;
    this.nx = Math.max(1, Math.floor(width / CELL));
    this.nz = Math.max(1, Math.floor(depth / CELL));
    this.grid = new Uint8Array(this.nx * this.nz);
  }

  isFree(ix0, iz0, nw, nd) {
    if (ix0 < 0 || iz0 < 0 || ix0 + nw > this.nx || iz0 + nd > this.nz) return false;
    for (let iz = iz0; iz < iz0 + nd; iz++) {
      const row = iz * this.nx;
      for (let ix = ix0; ix < ix0 + nw; ix++) if (this.grid[row + ix]) return false;
    }
    return true;
  }

  fill(ix0, iz0, nw, nd) {
    for (let iz = Math.max(0, iz0); iz < Math.min(this.nz, iz0 + nd); iz++) {
      const row = iz * this.nx;
      for (let ix = Math.max(0, ix0); ix < Math.min(this.nx, ix0 + nw); ix++) this.grid[row + ix] = 1;
    }
  }

  /** Back to front, left to right: the order you would actually load a rack. */
  place(w, d, minZ = null) {
    const nw = Math.ceil((w + GAP) / CELL);
    const nd = Math.ceil((d + GAP) / CELL);
    const iz0 = minZ === null ? 0 : Math.max(0, Math.ceil((minZ + this.d / 2) / CELL));
    for (let iz = iz0; iz + nd <= this.nz; iz++) {
      for (let ix = 0; ix + nw <= this.nx; ix++) {
        if (!this.isFree(ix, iz, nw, nd)) continue;
        this.fill(ix, iz, nw, nd);
        return {
          x: (ix + nw / 2) * CELL - this.w / 2,
          z: (iz + nd / 2) * CELL - this.d / 2,
        };
      }
    }
    return null;
  }

  /**
   * Find room for something standing in a tine row: a fixed z band, and the first
   * run of `w` free cells along it. Plates are thin, so they can slide in around
   * whatever is already on the floor — which is why they are packed last.
   */
  placeInBand(zCentre, bandDepth, w) {
    const nd = Math.max(1, Math.ceil(bandDepth / CELL));
    const iz = Math.floor((zCentre - bandDepth / 2 + this.d / 2) / CELL);
    if (iz < 0 || iz + nd > this.nz) return null;
    const nw = Math.ceil((w + GAP) / CELL);
    for (let ix = 0; ix + nw <= this.nx; ix++) {
      if (!this.isFree(ix, iz, nw, nd)) continue;
      this.fill(ix, iz, nw, nd);
      return { x: (ix + nw / 2) * CELL - this.w / 2 };
    }
    return null;
  }

  /** Reserve a rectangle centred on (x, z) — the cutlery basket, a row of plates. */
  reserve(x, z, w, d) {
    const ix = Math.floor((x - w / 2 + this.w / 2) / CELL);
    const iz = Math.floor((z - d / 2 + this.d / 2) / CELL);
    this.fill(ix, iz, Math.ceil(w / CELL), Math.ceil(d / CELL));
  }
}

/* ------------------------------------------------------------------ *
 *  Orientation
 * ------------------------------------------------------------------ */
/**
 * Two poses cover everything: `down` turns an item opening-down (a quarter turn short
 * of that would hold water), `edge` stands it on its rim, which is how a plate goes
 * into a tine row and how a whisk lies flat.
 */
function poseQuaternion(pose, yaw) {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose === 'edge' ? Math.PI / 2 : Math.PI, 0, 0, 'XYZ'),
  );
  if (yaw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  return q;
}

/** World-space extents of an item in a given pose. */
function poseSize(size, pose, yaw) {
  // `edge` is a quarter turn about X, which swaps the item's height and depth
  let s = pose === 'edge' ? [size.x, size.z, size.y] : [size.x, size.y, size.z];
  if (yaw) s = [s[2], s[1], s[0]];
  return { w: s[0], h: s[1], d: s[2] };
}

/* ------------------------------------------------------------------ *
 *  The plan
 * ------------------------------------------------------------------ */
/**
 * @returns {{ placements: Array, unplaced: Array, notes: string[] }}
 *   Each placement is { id, x, y, z, quat } with x and z relative to the rack centre
 *   and y absolute, plus which rack it belongs to.
 */
export function planLevel(level) {
  const queue = [];
  for (const [id, n] of level.items) for (let i = 0; i < n; i++) queue.push(id);

  // measure each distinct item once — building a dish is not free
  const spec = new Map();
  for (const id of new Set(queue)) {
    const built = createDish(id);
    spec.set(id, { size: built.size, openVessel: built.openVessel, def: DISHES[id] });
  }

  const lower = new Deck(RACKS.lower.w - 0.012, RACKS.lower.d - 0.012);
  const upper = new Deck(RACKS.upper.w - 0.012, RACKS.upper.d - 0.012);
  // the cutlery basket occupies the front-left of the lower deck
  lower.reserve(-0.134, 0.182, 0.225, 0.094);

  const placements = [];
  const unplaced = [];
  const notes = [];

  const byId = (a, b) => spec.get(b).size.x * spec.get(b).size.z - spec.get(a).size.x * spec.get(a).size.z;
  const rest = { lower: [], upper: [], basket: [] };
  for (const id of queue) {
    const s = spec.get(id);
    const where = s.def.belongs === 'basket' ? 'basket' : (s.def.belongs === 'upper' ? 'upper' : 'lower');
    rest[where].push(id);
  }

  /* ---- 1. cutlery, standing in the basket ---- */
  const basketSpots = cutlerySpots();
  for (const id of rest.basket) {
    const spot = basketSpots.shift();
    if (!spot) { rest.upper.push(id); continue; }   // basket full: lie the rest up top
    const s = spec.get(id);
    placements.push({
      id, rack: 'lower', x: spot.x, z: spot.z,
      y: RACKS.lower.y + 0.012 + s.size.z / 2,      // stood on end, handle down
      quat: poseQuaternion('edge', false),
    });
  }

  /* ---- 2. divide the lower deck up before packing anything into it ----
     A plate standing in a tine row and a stockpot lying face down both want the same
     floor, and neither can give: the plate needs a gap between two rows to stay
     upright, and the pot needs one unbroken patch. Fighting over it greedily leaves
     one of them homeless, so the rack is zoned first — the front tine rows go to the
     plates, and everything behind them is the pots' floor. */
  const standing = rest.lower.filter((id) => STANDS_IN_TINES.has(id)).sort(byId);
  const flatLower = rest.lower.filter((id) => !STANDS_IN_TINES.has(id));

  const slotZs = tineSlots(RACKS.lower);
  const usableWidth = RACKS.lower.w - 0.05;

  /* Lay the plates out for real before reserving anything: an estimate of how many
     rows they need is always wrong, because a row's leftover width is wasted the
     moment the next plate is wider than it. Rows fill from the front backwards, so
     the pots keep one unbroken patch at the back. */
  /* Rows fill from the back forwards. Filling from the front splits the floor into
     two thin strips with the plates in between, and a roasting tin fits in neither. */
  const ex = RACKS.lower.tineExclude;
  const bands = slotZs.filter((z) => !ex || z <= ex.z0 - 0.02 || z >= ex.z1);
  const cursors = new Map();
  const standingPlan = [];
  for (const id of standing) {
    const size = poseSize(spec.get(id).size, 'edge', false);
    if (RACKS.lower.y + size.h > RACKS.lower.ceiling) {
      unplaced.push({ id, why: 'too tall to stand in the lower rack' });
      continue;
    }
    let z = bands.find((b) => cursors.has(b) && cursors.get(b) + size.w <= usableWidth / 2);
    if (z === undefined) z = bands.find((b) => !cursors.has(b));      // open a new row
    if (z === undefined) { unplaced.push({ id, why: 'no free tine row' }); continue; }
    if (!cursors.has(z)) cursors.set(z, -usableWidth / 2);
    standingPlan.push({ id, z, x: cursors.get(z) + size.w / 2, h: size.h });
    cursors.set(z, cursors.get(z) + size.w + GAP);
  }
  /* Reserve only the width each row actually used. Blocking a whole row for one
     dinner plate throws away a fifth of the deck, and the pots need that floor. */
  for (const [z, cursor] of cursors) {
    const used = cursor + usableWidth / 2;
    lower.reserve((cursor - usableWidth / 2) / 2, z, used, 0.035);   // the slot itself, not the whole row pitch
  }

  const decks = {
    lower: { deck: lower, cfg: RACKS.lower, name: 'lower' },
    upper: { deck: upper, cfg: RACKS.upper, name: 'upper' },
  };

  /**
   * Try one item every way round that is allowed, in its own rack first and then the
   * other one. An open vessel may only go opening-down — turning it on its side to
   * save floor space would leave it holding water — but anything else may lie flat,
   * which is how a ladle and a whisk get in at all.
   */
  function pack(id) {
    const s = spec.get(id);
    const home = s.def.belongs === 'upper' ? 'upper' : 'lower';
    const order = home === 'upper' ? ['upper', 'lower'] : ['lower', 'upper'];
    const poses = s.openVessel ? ['down'] : ['down', 'edge'];
    let everFitted = false;          // did any pose clear the headroom anywhere?

    for (const rackName of order) {
      const { deck, cfg } = decks[rackName];
      for (const pose of poses) {
        for (const yaw of [false, true]) {
          const size = poseSize(s.size, pose, yaw);
          // the tine field covers the whole deck, so everything rests on its tips
          if (cfg.y + cfg.tineHeight + size.h > cfg.ceiling) continue;
          everFitted = true;
          const spot = deck.place(size.w, size.d);
          if (!spot) continue;
          placements.push({
            id, rack: rackName, x: spot.x, z: spot.z,
            y: cfg.y + cfg.tineHeight + size.h / 2 + 0.003,
            quat: poseQuaternion(pose, yaw),
          });
          if (rackName !== home) {
            notes.push(`${s.def.name} went in the ${rackName} rack — its own was full.`);
          }
          return true;
        }
      }
    }
    unplaced.push({ id, why: everFitted ? 'no floor left in either rack' : 'too tall for either rack' });
    return false;
  }

  for (const id of [...rest.upper, ...flatLower].sort(byId)) pack(id);

  /* ---- 3. commit the plate layout worked out above ---- */
  for (const p of standingPlan) {
    placements.push({
      id: p.id, rack: 'lower', x: p.x, z: p.z,
      y: RACKS.lower.y + p.h / 2 + 0.004,       // dropped into the gap, not onto the tips
      quat: poseQuaternion('edge', false),
    });
  }

  if (unplaced.length) {
    notes.push(`${unplaced.length} item${unplaced.length === 1 ? '' : 's'} would not fit.`);
  }
  return { placements, unplaced, notes };
}

/** Midpoints between adjacent tine rows — the gaps a plate drops into. */
function tineSlots(cfg) {
  const out = [];
  for (let i = 0; i < cfg.tineRows.length - 1; i++) {
    out.push((cfg.tineRows[i] + cfg.tineRows[i + 1]) / 2);
  }
  return out;
}

/** Standing positions inside the cutlery basket, avoiding the centre divider. */
function cutlerySpots() {
  const spots = [];
  const bx = -0.134, bz = 0.182;
  for (const dz of [-0.017, 0.017]) {
    for (const dx of [-0.085, -0.055, -0.025, 0.025, 0.055, 0.085]) {
      spots.push({ x: bx + dx, z: bz + dz });
    }
  }
  return spots;
}
