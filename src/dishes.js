/**
 * The crockery catalogue.
 *
 * Every item is built base-at-y=0 and then re-centred, because cannon-es puts a
 * body's centre of mass at its origin and approximates inertia from the AABB — so an
 * origin at the base would give every mug an absurdly low centre of gravity and
 * nothing would ever tip over. Re-centring costs one Box3 and buys believable
 * toppling.
 *
 * Visuals are lathed profiles (real curves, real rims); collision is a cheap
 * approximation of the same profile. Open vessels get a hollow shell so you really
 * can drop a teaspoon into a mug.
 */
import * as THREE from 'three';
import { partBox, partCylinder, partSphere, partsVessel, partsOpenBox } from './physics.js';

/* ------------------------------ materials ------------------------------ */
const M = {
  porcelain: new THREE.MeshPhysicalMaterial({
    color: 0xf5f2ec, roughness: 0.22, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.15,
  }),
  porcelainBlue: new THREE.MeshPhysicalMaterial({
    color: 0xd7e3ee, roughness: 0.2, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.12,
  }),
  stoneware: new THREE.MeshPhysicalMaterial({
    color: 0x9fb3a6, roughness: 0.4, metalness: 0, clearcoat: 0.4,
  }),
  terracotta: new THREE.MeshPhysicalMaterial({
    color: 0xc0705a, roughness: 0.45, metalness: 0, clearcoat: 0.35,
  }),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0xdff0ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3,
    envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false,
  }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc2c8ce, metalness: 0.94, roughness: 0.22 }),
  steelBrushed: new THREE.MeshStandardMaterial({ color: 0xa8b0b8, metalness: 0.88, roughness: 0.38 }),
  nonstick: new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.35, roughness: 0.48 }),
  cast: new THREE.MeshStandardMaterial({ color: 0x33363a, metalness: 0.5, roughness: 0.68 }),
  plasticBlue: new THREE.MeshStandardMaterial({ color: 0x3d78c8, roughness: 0.45, metalness: 0.03 }),
  plasticRed: new THREE.MeshStandardMaterial({ color: 0xd0503f, roughness: 0.45, metalness: 0.03 }),
  plasticGreen: new THREE.MeshStandardMaterial({ color: 0x4aa860, roughness: 0.45, metalness: 0.03 }),
  plasticClear: new THREE.MeshPhysicalMaterial({
    color: 0xeaf4ff, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.42,
    side: THREE.DoubleSide, depthWrite: false,
  }),
  plasticDark: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.5, metalness: 0.05 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb5834f, roughness: 0.72, metalness: 0 }),
};
export const DISH_MATERIALS = M;

/* ------------------------------- helpers ------------------------------- */
const V2 = (x, y) => new THREE.Vector2(x, y);

function lathe(points, material, segments = 28) {
  const g = new THREE.LatheGeometry(points, segments);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function box(w, h, d, material, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(...pos); m.rotation.set(...rot);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, material, pos = [0, 0, 0], rot = [0, 0, 0], seg = 18) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(...pos); m.rotation.set(...rot);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Profile of an open vessel: up the outside, over the rim, back down the inside. */
function vesselProfile(rBottom, rTop, height, wall = 0.005, base = 0.006, curve = 0) {
  const pts = [V2(0, 0), V2(rBottom * 0.82, 0), V2(rBottom, base * 0.6)];
  const N = 7;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const bulge = Math.sin(t * Math.PI) * curve;
    pts.push(V2(rBottom + (rTop - rBottom) * t + bulge, base * 0.6 + (height - base * 0.6) * t));
  }
  pts.push(V2(rTop - wall, height - wall * 0.4));
  for (let i = N; i >= 1; i--) {
    const t = i / N;
    const bulge = Math.sin(t * Math.PI) * curve;
    pts.push(V2(Math.max(0.001, rBottom + (rTop - rBottom) * t + bulge - wall), base + (height - base) * t));
  }
  pts.push(V2(rBottom * 0.8 - wall * 0.5, base), V2(0, base));
  return pts;
}

/** Profile of a plate: shallow well, upswept rim. */
function plateProfile(r, rim, t) {
  return [
    V2(0, 0), V2(r * 0.55, 0), V2(r * 0.86, rim * 0.25), V2(r, rim),
    V2(r, rim + t), V2(r * 0.84, rim * 0.25 + t), V2(r * 0.5, t), V2(0, t),
  ];
}

/**
 * Re-centre a freshly built dish so the body origin sits at the geometric centre,
 * and hand back the metadata the rest of the game needs.
 */
function finalize(group, parts, def) {
  group.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(group);
  const c = bbox.getCenter(new THREE.Vector3());
  const size = bbox.getSize(new THREE.Vector3());

  for (const child of group.children) child.position.sub(c);
  for (const p of parts) { p.offset.x -= c.x; p.offset.y -= c.y; p.offset.z -= c.z; }

  return {
    mesh: group,
    parts,
    size,
    /** How far the lowest point sits below the origin. */
    bottom: bbox.min.y - c.y,
    radius: Math.max(size.x, size.z) / 2,
    def,
  };
}

/* ========================================================================= *
 *  Builders — one per family
 * ========================================================================= */

function buildPlate(def) {
  const { r, rim = 0.017, t = 0.006, material } = def.geom;
  const g = new THREE.Group();
  g.add(lathe(plateProfile(r, rim, t), material, 32));
  const parts = [partCylinder(r, r * 0.92, rim + t, [0, (rim + t) / 2, 0], null, 10)];
  return finalize(g, parts, def);
}

function buildPlatter(def) {
  const { r, rim = 0.018, t = 0.007, squash = 0.68, material } = def.geom;
  const g = new THREE.Group();
  const m = lathe(plateProfile(r, rim, t), material, 32);
  m.scale.z = squash;
  g.add(m);
  const parts = [partBox(r * 2, rim + t, r * 2 * squash, [0, (rim + t) / 2, 0])];
  return finalize(g, parts, def);
}

function buildVessel(def) {
  const {
    rBottom, rTop, height, wall = 0.005, base = 0.007, curve = 0, material,
    handle = null, ears = false,
  } = def.geom;

  const g = new THREE.Group();
  g.add(lathe(vesselProfile(rBottom, rTop, height, wall, base, curve), material, 30));

  /* Wall segment count is the main lever on physics cost, and it is narrowphase —
     not the solver — that a full machine pays for. A mug is a hexagon inside; nothing
     you can fit in one will notice, and a stockpot that has to swallow a ladle gets
     the finer shell. */
  const segments = def.geom.segments ?? (rTop < 0.06 ? 6 : 8);
  const parts = partsVessel({ rBottom, rTop, height, segments, wall: Math.max(wall, 0.005), base });

  if (handle === 'loop') {                      // mug: a ring on the side
    const rr = Math.min(0.03, height * 0.3);
    const t = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0055, 8, 18, Math.PI * 1.35), material);
    t.rotation.set(0, Math.PI / 2, -Math.PI * 0.32);
    t.position.set(rTop * 0.96, height * 0.52, 0);
    t.castShadow = true;
    g.add(t);
    parts.push(partBox(0.012, rr * 2, 0.012, [rTop + rr * 0.75, height * 0.52, 0]));
  } else if (handle === 'stick') {              // saucepan / frying pan
    const L = def.geom.handleLength ?? 0.18;
    const hm = box(L, 0.019, 0.024, def.geom.handleMaterial ?? M.plasticDark,
      [rTop + L / 2 - 0.005, height * 0.72, 0], [0, 0, -0.06]);
    g.add(hm);
    const grip = cyl(0.013, 0.011, 0.03, def.geom.handleMaterial ?? M.plasticDark,
      [rTop + L - 0.02, height * 0.72 + 0.006, 0], [0, 0, Math.PI / 2]);
    g.add(grip);
    parts.push(partBox(L, 0.021, 0.026, [rTop + L / 2 - 0.005, height * 0.72, 0], [0, 0, -0.06]));
  } else if (handle === 'ears' || ears) {       // stockpot / colander / casserole
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 8, 14, Math.PI), material);
      e.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI);
      e.position.set(s * (rTop + 0.024), height * 0.86, 0);
      e.castShadow = true;
      g.add(e);
      parts.push(partBox(0.05, 0.012, 0.03, [s * (rTop + 0.026), height * 0.86, 0]));
    }
  } else if (handle === 'jug') {                // blender jug / measuring jug
    const t = new THREE.Mesh(new THREE.TorusGeometry(height * 0.26, 0.008, 8, 18, Math.PI * 1.1), material);
    t.rotation.set(0, Math.PI / 2, -Math.PI * 0.35);
    t.position.set(rTop * 0.98, height * 0.55, 0);
    g.add(t);
    parts.push(partBox(0.016, height * 0.52, 0.018, [rTop + height * 0.2, height * 0.55, 0]));
  }

  const res = finalize(g, parts, def);
  res.openVessel = true;
  return res;
}

function buildOpenBox(def) {
  const { w, d, height, wall = 0.008, material, ears = false } = def.geom;
  const g = new THREE.Group();
  const base = 0.008;
  g.add(box(w, base, d, material, [0, base / 2, 0]));
  g.add(box(w, height - base, wall, material, [0, base + (height - base) / 2, d / 2 - wall / 2]));
  g.add(box(w, height - base, wall, material, [0, base + (height - base) / 2, -d / 2 + wall / 2]));
  g.add(box(wall, height - base, d - wall * 2, material, [w / 2 - wall / 2, base + (height - base) / 2, 0]));
  g.add(box(wall, height - base, d - wall * 2, material, [-w / 2 + wall / 2, base + (height - base) / 2, 0]));

  const parts = partsOpenBox({ w, d, height, wall, base });
  if (ears) {
    for (const s of [-1, 1]) {
      g.add(box(0.05, 0.014, 0.035, material, [s * (w / 2 + 0.022), height * 0.8, 0]));
      parts.push(partBox(0.05, 0.014, 0.035, [s * (w / 2 + 0.022), height * 0.8, 0]));
    }
  }
  const res = finalize(g, parts, def);
  res.openVessel = true;
  return res;
}

function buildFlatBox(def) {
  const { w, h, d, material, lip = 0 } = def.geom;
  const g = new THREE.Group();
  g.add(box(w, h, d, material, [0, h / 2, 0]));
  const parts = [partBox(w, h, d, [0, h / 2, 0])];
  if (lip > 0) {
    for (const s of [-1, 1]) {
      g.add(box(w, lip, 0.006, material, [0, h + lip / 2, s * (d / 2 - 0.003)]));
      g.add(box(0.006, lip, d, material, [s * (w / 2 - 0.003), h + lip / 2, 0]));
    }
    parts.push(partBox(w, lip, d, [0, h + lip / 2, 0]));
  }
  return finalize(g, parts, def);
}

function buildCutlery(def) {
  const { len, bladeW = 0.018, thick = 0.0035, headW = 0.026, headL = 0.05, kind } = def.geom;
  const g = new THREE.Group();
  const mat = M.steel;
  g.add(box(bladeW, thick, len - headL, mat, [0, thick / 2, headL / 2]));

  if (kind === 'fork') {
    const headZ = -(len / 2) + headL / 2;
    for (let i = -1.5; i <= 1.5; i++) g.add(box(0.004, thick, headL, mat, [i * 0.0065, thick / 2, headZ]));
    g.add(box(headW, thick, headL * 0.35, mat, [0, thick / 2, headZ + headL * 0.4]));
  } else if (kind === 'spoon') {
    const bowl = lathe(vesselProfile(0.010, headW / 2, 0.010, 0.002, 0.002), mat, 16);
    bowl.scale.set(1, 1, 1.5);
    bowl.rotation.x = Math.PI;
    bowl.position.set(0, 0.008, -(len / 2) + headL / 2);
    g.add(bowl);
  } else {                                    // knife
    g.add(box(headW * 0.8, thick * 1.4, headL * 1.4, mat, [0, thick / 2, -(len / 2) + headL * 0.7]));
    g.add(box(bladeW, thick * 2.4, len * 0.36, M.plasticDark, [0, thick * 1.2, len / 2 - len * 0.18]));
  }

  const parts = [
    partBox(headW, thick * 2.6, len, [0, thick * 1.1, 0]),
  ];
  const res = finalize(g, parts, def);
  return res;
}

function buildUtensil(def) {
  const { kind } = def.geom;
  const g = new THREE.Group();
  const parts = [];

  if (kind === 'whisk') {
    const grip = cyl(0.011, 0.013, 0.085, M.plasticDark, [0, 0.0425, 0]);
    g.add(grip);
    const collar = cyl(0.009, 0.011, 0.02, M.steel, [0, 0.095, 0]);
    g.add(collar);
    for (let i = 0; i < 6; i++) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.0016, 6, 20, Math.PI), M.steel);
      loop.rotation.set(0, (i / 6) * Math.PI, 0);
      loop.position.set(0, 0.148, 0);
      loop.scale.set(1, 1.9, 1);
      g.add(loop);
    }
    parts.push(partCylinder(0.013, 0.013, 0.105, [0, 0.052, 0], null, 8));
    parts.push(partSphere(0.031, [0, 0.148, 0]));
  } else if (kind === 'ladle') {
    const shaft = cyl(0.007, 0.007, 0.22, M.steel, [0, 0.11, 0]);
    g.add(shaft);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0035, 6, 14, Math.PI * 1.4), M.steel);
    hook.rotation.set(Math.PI / 2, 0, 0);
    hook.position.set(0, 0.228, 0.011);
    g.add(hook);
    const bowl = lathe(vesselProfile(0.018, 0.042, 0.032, 0.003, 0.003, 0.006), M.steel, 20);
    bowl.rotation.x = Math.PI * 0.62;
    bowl.position.set(0, 0.028, 0.03);
    g.add(bowl);
    parts.push(partCylinder(0.008, 0.008, 0.235, [0, 0.115, 0], null, 8));
    parts.push(partCylinder(0.042, 0.03, 0.035, [0, 0.03, 0.032], [Math.PI * 0.62, 0, 0], 10));
  } else if (kind === 'spatula') {
    g.add(box(0.05, 0.004, 0.09, M.plasticDark, [0, 0.002, -0.075]));
    g.add(box(0.022, 0.012, 0.17, M.plasticRed, [0, 0.006, 0.055]));
    parts.push(partBox(0.05, 0.008, 0.09, [0, 0.004, -0.075]));
    parts.push(partBox(0.024, 0.014, 0.17, [0, 0.007, 0.055]));
  } else if (kind === 'tongs') {
    for (const s of [-1, 1]) {
      g.add(box(0.016, 0.004, 0.2, M.steel, [s * 0.012, 0.006 + s * 0.004, 0], [s * 0.05, 0, 0]));
      g.add(box(0.026, 0.006, 0.035, M.plasticDark, [s * 0.014, 0.008, -0.105]));
    }
    parts.push(partBox(0.05, 0.026, 0.235, [0, 0.013, -0.01]));
  } else if (kind === 'peeler') {
    g.add(box(0.03, 0.01, 0.09, M.plasticGreen, [0, 0.005, 0.02]));
    g.add(box(0.045, 0.004, 0.03, M.steel, [0, 0.006, -0.038]));
    parts.push(partBox(0.045, 0.012, 0.13, [0, 0.006, 0.005]));
  }
  return finalize(g, parts, def);
}

function buildWineGlass(def) {
  const { bowlR = 0.042, stem = 0.085, bowlH = 0.085, baseR = 0.038 } = def.geom;
  const g = new THREE.Group();
  const total = stem + bowlH + 0.008;
  const pts = [
    V2(0, 0), V2(baseR, 0), V2(baseR, 0.004), V2(0.010, 0.016),
    V2(0.0045, 0.03), V2(0.0045, stem),
    V2(0.016, stem + 0.012), V2(0.032, stem + bowlH * 0.35),
    V2(bowlR, stem + bowlH * 0.75), V2(bowlR * 0.97, stem + bowlH),
    V2(bowlR * 0.94, stem + bowlH), V2(bowlR * 0.94, stem + bowlH * 0.75),
    V2(0.027, stem + bowlH * 0.35), V2(0.011, stem + 0.016), V2(0, stem + 0.014),
  ];
  g.add(lathe(pts, M.glass, 26));

  const parts = [
    partCylinder(baseR, baseR, 0.008, [0, 0.004, 0], null, 12),
    partCylinder(0.008, 0.008, stem, [0, stem / 2, 0], null, 8),
    ...partsVessel({ rBottom: 0.022, rTop: bowlR, height: bowlH, segments: 6, wall: 0.004, base: 0.005, yBase: stem }),
  ];
  const res = finalize(g, parts, { ...def, geom: { ...def.geom, height: total } });
  res.openVessel = true;
  return res;
}

function buildLid(def) {
  const { r, h = 0.032, material } = def.geom;
  const g = new THREE.Group();
  const pts = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(V2(r * Math.sin((t * Math.PI) / 2), h * Math.cos((t * Math.PI) / 2) * 0.0 + h * (1 - t)));
  }
  pts.reverse();
  pts.unshift(V2(0, h));
  pts.push(V2(r, 0), V2(r, -0.006), V2(r - 0.006, -0.006));
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    pts.push(V2(Math.max(0.001, r * Math.sin((t * Math.PI) / 2) - 0.006), h * (1 - t) - 0.004));
  }
  g.add(lathe(pts, material ?? M.glass, 28));
  const knob = cyl(0.016, 0.013, 0.022, M.plasticDark, [0, h + 0.009, 0]);
  g.add(knob);
  const parts = [
    partCylinder(r * 0.55, r, h, [0, h / 2, 0], null, 10),
    partCylinder(0.017, 0.014, 0.024, [0, h + 0.01, 0], null, 8),
  ];
  return finalize(g, parts, def);
}

function buildColander(def) {
  const res = buildVessel({ ...def, geom: { ...def.geom, handle: 'ears' } });
  // perforation reads as a band of dimples — cheaper than punching real holes
  const { rTop, height } = def.geom;
  for (let ring = 0; ring < 3; ring++) {
    const y = height * (0.35 + ring * 0.2);
    const rr = def.geom.rBottom + (rTop - def.geom.rBottom) * (0.35 + ring * 0.2);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + ring * 0.2;
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 6), M.plasticDark);
      hole.rotation.set(Math.PI / 2, 0, -a);
      // res.bottom is where the base sits relative to the re-centred origin
      hole.position.set(Math.sin(a) * rr, res.bottom + y, Math.cos(a) * rr);
      res.mesh.add(hole);
    }
  }
  return res;
}

function buildWok(def) {
  const { r = 0.155, depth = 0.09, material = M.cast } = def.geom;
  const g = new THREE.Group();
  const pts = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(V2(r * Math.sin((t * Math.PI) / 2) * 0.99, depth * (1 - Math.cos((t * Math.PI) / 2))));
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    pts.push(V2(Math.max(0.001, r * Math.sin((t * Math.PI) / 2) * 0.99 - 0.005),
      depth * (1 - Math.cos((t * Math.PI) / 2)) + 0.005));
  }
  g.add(lathe(pts, material, 30));
  // two loop handles
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 14, Math.PI), material);
    e.rotation.set(Math.PI / 2, 0, s > 0 ? 0 : Math.PI);
    e.position.set(s * (r + 0.026), depth * 0.92, 0);
    e.castShadow = true;
    g.add(e);
  }
  const parts = [
    ...partsVessel({ rBottom: r * 0.35, rTop: r, height: depth, segments: 10, wall: 0.007, base: 0.008 }),
    partBox(0.05, 0.014, 0.032, [(r + 0.028), depth * 0.92, 0]),
    partBox(0.05, 0.014, 0.032, [-(r + 0.028), depth * 0.92, 0]),
  ];
  const res = finalize(g, parts, def);
  res.openVessel = true;
  return res;
}

/* ========================================================================= *
 *  Catalogue
 * ========================================================================= */
const build = {
  plate: buildPlate, platter: buildPlatter, vessel: buildVessel, openBox: buildOpenBox,
  flatBox: buildFlatBox, cutlery: buildCutlery, utensil: buildUtensil,
  wineGlass: buildWineGlass, lid: buildLid, colander: buildColander, wok: buildWok,
};

/**
 * type      -> which builder
 * mass      -> kg
 * fragile   -> china and glass; belongs in the upper rack
 * cutlery   -> belongs in the basket
 * bulky     -> pots and trays; the game nags if they go up top
 */
export const DISHES = {
  /* --- plates ------------------------------------------------------- */
  'dinner-plate':  { name: 'Dinner plate',  type: 'plate',  mass: 0.62, fragile: true,
    geom: { r: 0.132, rim: 0.019, t: 0.006, material: M.porcelain } },
  'side-plate':    { name: 'Side plate',    type: 'plate',  mass: 0.34, fragile: true,
    geom: { r: 0.098, rim: 0.014, t: 0.005, material: M.porcelainBlue } },
  'saucer':        { name: 'Saucer',        type: 'plate',  mass: 0.18, fragile: true,
    geom: { r: 0.072, rim: 0.010, t: 0.004, material: M.porcelain } },
  'platter':       { name: 'Serving platter', type: 'platter', mass: 1.05, fragile: true, bulky: true,
    geom: { r: 0.168, rim: 0.020, t: 0.007, squash: 0.66, material: M.porcelain } },

  /* --- bowls -------------------------------------------------------- */
  'cereal-bowl':   { name: 'Cereal bowl',   type: 'vessel', mass: 0.36, fragile: true,
    geom: { rBottom: 0.044, rTop: 0.086, height: 0.062, curve: 0.004, material: M.porcelain } },
  'soup-bowl':     { name: 'Soup bowl',     type: 'vessel', mass: 0.42, fragile: true,
    geom: { rBottom: 0.055, rTop: 0.102, height: 0.050, material: M.porcelainBlue } },
  'ramekin':       { name: 'Ramekin',       type: 'vessel', mass: 0.20, fragile: true,
    geom: { rBottom: 0.038, rTop: 0.047, height: 0.042, material: M.porcelain } },
  'mixing-bowl':   { name: 'Mixing bowl',   type: 'vessel', mass: 0.95, bulky: true,
    geom: { rBottom: 0.068, rTop: 0.146, height: 0.108, curve: 0.006, material: M.stoneware } },
  'salad-bowl':    { name: 'Salad bowl',    type: 'vessel', mass: 0.70, fragile: true, bulky: true,
    geom: { rBottom: 0.060, rTop: 0.128, height: 0.082, curve: 0.005, material: M.glass, wall: 0.006 } },

  /* --- cups --------------------------------------------------------- */
  'mug':           { name: 'Mug',           type: 'vessel', mass: 0.33, fragile: true,
    geom: { rBottom: 0.037, rTop: 0.042, height: 0.094, handle: 'loop', material: M.porcelain } },
  'espresso-cup':  { name: 'Espresso cup',  type: 'vessel', mass: 0.16, fragile: true,
    geom: { rBottom: 0.026, rTop: 0.032, height: 0.056, handle: 'loop', material: M.porcelainBlue } },
  'glass':         { name: 'Tumbler',       type: 'vessel', mass: 0.26, fragile: true,
    geom: { rBottom: 0.029, rTop: 0.035, height: 0.122, material: M.glass, wall: 0.004 } },
  'wine-glass':    { name: 'Wine glass',    type: 'wineGlass', mass: 0.21, fragile: true, delicate: true,
    geom: { bowlR: 0.042, stem: 0.085, bowlH: 0.086, baseR: 0.038 } },
  'travel-mug':    { name: 'Travel mug',    type: 'vessel', mass: 0.38,
    geom: { rBottom: 0.035, rTop: 0.038, height: 0.185, material: M.steelBrushed } },
  'sippy-cup':     { name: 'Sippy cup',     type: 'vessel', mass: 0.12,
    geom: { rBottom: 0.031, rTop: 0.035, height: 0.098, handle: 'loop', material: M.plasticGreen } },
  'baby-bottle':   { name: 'Baby bottle',   type: 'vessel', mass: 0.14,
    geom: { rBottom: 0.029, rTop: 0.026, height: 0.142, material: M.plasticClear, wall: 0.004 } },

  /* --- pots and pans ------------------------------------------------ */
  'saucepan':      { name: 'Saucepan',      type: 'vessel', mass: 1.15, bulky: true,
    geom: { rBottom: 0.082, rTop: 0.088, height: 0.092, handle: 'stick', handleLength: 0.175,
      material: M.steel, wall: 0.006 } },
  'stockpot':      { name: 'Stockpot',      type: 'vessel', mass: 1.9, bulky: true,
    geom: { rBottom: 0.105, rTop: 0.110, height: 0.168, handle: 'ears', material: M.steel, wall: 0.006 } },
  'frying-pan':    { name: 'Frying pan',    type: 'vessel', mass: 1.35, bulky: true,
    geom: { rBottom: 0.098, rTop: 0.126, height: 0.052, handle: 'stick', handleLength: 0.195,
      material: M.nonstick, wall: 0.007 } },
  'wok':           { name: 'Wok',           type: 'wok',    mass: 1.6, bulky: true,
    geom: { r: 0.152, depth: 0.088, material: M.cast } },
  'casserole':     { name: 'Casserole dish', type: 'openBox', mass: 1.7, bulky: true,
    geom: { w: 0.245, d: 0.165, height: 0.088, wall: 0.011, ears: true, material: M.terracotta } },
  'casserole-lid': { name: 'Casserole lid', type: 'lid',    mass: 0.62, fragile: true,
    geom: { r: 0.124, h: 0.030, material: M.glass } },
  'roasting-tin':  { name: 'Roasting tin',  type: 'openBox', mass: 1.4, bulky: true,
    geom: { w: 0.285, d: 0.205, height: 0.068, wall: 0.009, material: M.steelBrushed } },
  'baking-tray':   { name: 'Baking tray',   type: 'flatBox', mass: 0.85, bulky: true,
    geom: { w: 0.325, h: 0.014, d: 0.232, lip: 0.014, material: M.steelBrushed } },
  'cutting-board': { name: 'Chopping board', type: 'flatBox', mass: 0.80, bulky: true,
    geom: { w: 0.300, h: 0.016, d: 0.208, material: M.wood } },
  'colander':      { name: 'Colander',      type: 'colander', mass: 0.52, bulky: true,
    geom: { rBottom: 0.062, rTop: 0.115, height: 0.098, material: M.steelBrushed, wall: 0.005 } },
  'blender-jug':   { name: 'Blender jug',   type: 'vessel', mass: 0.9, bulky: true, delicate: true,
    geom: { rBottom: 0.058, rTop: 0.076, height: 0.185, handle: 'jug', material: M.plasticClear, wall: 0.005 } },
  'measuring-jug': { name: 'Measuring jug', type: 'vessel', mass: 0.34,
    geom: { rBottom: 0.052, rTop: 0.068, height: 0.128, handle: 'jug', material: M.plasticClear, wall: 0.004 } },
  'tupperware':    { name: 'Lunch box',     type: 'openBox', mass: 0.2,
    geom: { w: 0.158, d: 0.118, height: 0.070, wall: 0.006, material: M.plasticClear } },
  'tupperware-lid': { name: 'Lunch box lid', type: 'flatBox', mass: 0.08,
    geom: { w: 0.164, h: 0.008, d: 0.124, material: M.plasticBlue } },

  /* --- cutlery and utensils ---------------------------------------- */
  'fork':      { name: 'Fork',     type: 'cutlery', mass: 0.06, cutlery: true,
    geom: { len: 0.190, kind: 'fork' } },
  'knife':     { name: 'Knife',    type: 'cutlery', mass: 0.08, cutlery: true, sharp: true,
    geom: { len: 0.212, kind: 'knife' } },
  'spoon':     { name: 'Spoon',    type: 'cutlery', mass: 0.06, cutlery: true,
    geom: { len: 0.188, kind: 'spoon' } },
  'teaspoon':  { name: 'Teaspoon', type: 'cutlery', mass: 0.03, cutlery: true,
    geom: { len: 0.135, kind: 'spoon', headW: 0.020, headL: 0.035 } },
  'whisk':     { name: 'Whisk',    type: 'utensil', mass: 0.13,
    geom: { kind: 'whisk' } },
  'ladle':     { name: 'Ladle',    type: 'utensil', mass: 0.16,
    geom: { kind: 'ladle' } },
  'spatula':   { name: 'Spatula',  type: 'utensil', mass: 0.09,
    geom: { kind: 'spatula' } },
  'tongs':     { name: 'Tongs',    type: 'utensil', mass: 0.12,
    geom: { kind: 'tongs' } },
  'peeler':    { name: 'Peeler',   type: 'utensil', mass: 0.05,
    geom: { kind: 'peeler' } },
};

/**
 * Where each item belongs. Real guidance, and the basis of two rules: plates, pots
 * and trays go in the lower rack where the spray is strongest; cups, glasses and
 * light plastic go up top, out of the heat and where they cannot be knocked about.
 * Getting it wrong is a warning, not a failure — the load still washes.
 */
const BELONGS = {
  'dinner-plate': 'lower', 'side-plate': 'lower', 'saucer': 'upper', 'platter': 'lower',
  'cereal-bowl': 'upper', 'soup-bowl': 'lower', 'ramekin': 'upper',
  'mixing-bowl': 'lower', 'salad-bowl': 'lower',
  'mug': 'upper', 'espresso-cup': 'upper', 'glass': 'upper', 'wine-glass': 'upper',
  'travel-mug': 'upper', 'sippy-cup': 'upper', 'baby-bottle': 'upper',
  'saucepan': 'lower', 'stockpot': 'lower', 'frying-pan': 'lower', 'wok': 'lower',
  'casserole': 'lower', 'casserole-lid': 'either', 'roasting-tin': 'lower',
  'baking-tray': 'lower', 'cutting-board': 'lower', 'colander': 'lower',
  'blender-jug': 'lower', 'measuring-jug': 'upper',
  'tupperware': 'upper', 'tupperware-lid': 'upper',
  'whisk': 'upper', 'ladle': 'upper', 'spatula': 'upper', 'tongs': 'upper', 'peeler': 'upper',
};
for (const [id, where] of Object.entries(BELONGS)) DISHES[id].belongs = where;
for (const def of Object.values(DISHES)) if (def.cutlery) def.belongs = 'basket';

/** Build one instance. Meshes and shapes are made fresh per dish — there are never
 *  more than ~40 in a level, and sharing would break per-dish highlight tinting. */
export function createDish(id) {
  const def = DISHES[id];
  if (!def) throw new Error(`unknown dish: ${id}`);
  const built = build[def.type]({ ...def, id });
  built.id = id;
  built.def = { ...def, id };
  built.mesh.name = `dish:${id}`;
  built.mesh.userData.dishId = id;
  built.openVessel = built.openVessel ?? false;
  return built;
}

/** Silhouette data for the tray icons, in metres, base at y=0. */
export function iconShape(id) {
  const def = DISHES[id];
  const gm = def.geom;
  switch (def.type) {
    case 'plate':   return { kind: 'profile', pts: plateProfile(gm.r, gm.rim ?? 0.017, gm.t ?? 0.006), color: colorOf(gm.material) };
    case 'platter': return { kind: 'profile', pts: plateProfile(gm.r, gm.rim ?? 0.018, gm.t ?? 0.007), color: colorOf(gm.material) };
    case 'vessel':  return { kind: 'profile', pts: vesselProfile(gm.rBottom, gm.rTop, gm.height, gm.wall ?? 0.005, 0.007, gm.curve ?? 0), color: colorOf(gm.material) };
    case 'colander': return { kind: 'profile', pts: vesselProfile(gm.rBottom, gm.rTop, gm.height, 0.005, 0.007, 0), color: colorOf(gm.material) };
    case 'wok':     return { kind: 'profile', pts: [V2(0, 0), V2(gm.r * 0.5, gm.depth * 0.18), V2(gm.r * 0.85, gm.depth * 0.55), V2(gm.r, gm.depth), V2(gm.r - 0.006, gm.depth), V2(0, 0.006)], color: colorOf(gm.material) };
    case 'lid':     return { kind: 'profile', pts: [V2(0, gm.h), V2(gm.r * 0.6, gm.h * 0.8), V2(gm.r, 0), V2(gm.r, -0.005), V2(0, -0.005)], color: colorOf(gm.material) };
    case 'openBox': return { kind: 'rect', w: gm.w, h: gm.height, color: colorOf(gm.material), hollow: true };
    case 'flatBox': return { kind: 'rect', w: gm.w, h: gm.h + (gm.lip ?? 0), color: colorOf(gm.material) };
    case 'wineGlass': return { kind: 'profile', pts: [V2(0, 0), V2(gm.baseR, 0), V2(gm.baseR, 0.004), V2(0.006, 0.02), V2(0.006, gm.stem), V2(gm.bowlR, gm.stem + gm.bowlH * 0.8), V2(gm.bowlR * 0.95, gm.stem + gm.bowlH), V2(0, gm.stem + gm.bowlH * 0.1)], color: 0xdff0ff };
    case 'cutlery': return { kind: 'stick', len: gm.len, color: 0xc2c8ce, kind2: gm.kind };
    case 'utensil': return { kind: 'tool', tool: gm.kind, color: 0xc2c8ce };
    default:        return { kind: 'rect', w: 0.1, h: 0.1, color: 0xcccccc };
  }
}

function colorOf(mat) { return mat?.color ? mat.color.getHex() : 0xdddddd; }
