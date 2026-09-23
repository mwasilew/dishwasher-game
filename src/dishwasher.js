/**
 * The machine: tub, door, two sliding wire racks, cutlery basket, spray arms.
 *
 * Modelled in the style of the reference Bosch Series 2 Silence Plus, but built
 * procedurally — the racks in particular *have* to be code, because the game needs
 * their tines as collision geometry and needs to slide them on rails. If you own the
 * Sketchfab model, drop it in as assets/dishwasher.glb and it replaces the outer
 * shell (see loadShellOverride below); the racks stay procedural either way.
 *
 * Units are metres and match a real 60 cm machine.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CANNON, MAT, makeBody, partBox, partCylinder, partsOpenBox,
} from './physics.js';

/* ----------------------------- dimensions ----------------------------- */
export const TUB = {
  w: 0.55, d: 0.52, h: 0.63,
  y0: 0.12,                       // interior floor
  get y1() { return this.y0 + this.h; },
  get x0() { return -this.w / 2; },
  get x1() { return this.w / 2; },
  z0: -0.26, z1: 0.26,            // back / front (door plane)
};

export const RACKS = {
  /* Tines run the whole depth of both decks. A field that covers only part of a rack
     is worse than none at all: anything straddling its edge is propped up at one end
     and tips off. The lower rack has a moulded gap where the cutlery basket drops in. */
  lower: {
    y: 0.190, w: 0.505, d: 0.470, travel: 0.42,
    rim: 0.035,
    /* 4 cm apart, the whole depth of the deck. Five-centimetre spacing was costing a
       whole rack row per plate and left no floor for a pan; a real rack is tighter
       than that, which is how twelve settings fit in one. */
    tineRows: [-0.200, -0.160, -0.120, -0.080, -0.040, 0.000, 0.040, 0.080, 0.120, 0.160, 0.200],
    tineHeight: 0.075, tineXs: [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20],
    tineExclude: { x0: -0.250, x1: -0.018, z0: 0.140, z1: 0.226 },   // the basket well
    ceiling: 0.470,               // underside of the middle spray arm: the real height limit
  },
  upper: {
    y: 0.500, w: 0.505, d: 0.430, travel: 0.40,
    rim: 0.028,
    /* Barely-proud nubs. Cups and bowls are small and round, and a 2 cm prong grid
       gives an 8 cm rim only a couple of contact points to balance on — they rock off.
       Up here the tines are a guide, not a shelf. */
    tineRows: [-0.180, -0.130, -0.080, -0.030, 0.020, 0.070, 0.120, 0.170],
    tineHeight: 0.008, tineXs: [-0.19, -0.14, -0.09, -0.04, 0.01, 0.06, 0.11, 0.16],
    ceiling: 0.700,               // the roof wires and the top jet
  },
};

export const SPRAY_ARMS = [
  { y: 0.150, r: 0.215 },   // lower arm, under the lower rack
  { y: 0.478, r: 0.195 },   // middle arm, under the upper rack
  { y: 0.715, r: 0.150 },   // ceiling jet
];

/* ------------------------------ materials ------------------------------ */
const steel = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, metalness: 0.92, roughness: 0.28 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x6d757e, metalness: 0.85, roughness: 0.42 });
const tubMat = new THREE.MeshStandardMaterial({
  color: 0x9aa4ae, metalness: 0.86, roughness: 0.36, side: THREE.DoubleSide,
});
const wireMat = new THREE.MeshStandardMaterial({ color: 0xd6dbe0, metalness: 0.9, roughness: 0.22 });
const wireCoat = new THREE.MeshStandardMaterial({ color: 0x4d5b6b, metalness: 0.25, roughness: 0.55 });
const plasticMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, metalness: 0.05, roughness: 0.55 });
const glossBlack = new THREE.MeshStandardMaterial({ color: 0x14181c, metalness: 0.3, roughness: 0.18 });

/* ========================================================================= */
export function buildDishwasher(scene, world) {
  const root = new THREE.Group();
  root.name = 'dishwasher';
  scene.add(root);

  const shell = buildShell(root);
  buildTubBodies(world);
  const door = buildDoor(root, world);
  const arms = buildSprayArms(root);

  const lower = buildRack(root, world, 'lower', RACKS.lower);
  const upper = buildRack(root, world, 'upper', RACKS.upper);
  const cutlery = buildCutleryBasket(lower.group, world, lower);

  const dw = {
    root, shell, door, arms, racks: { lower, upper }, cutlery,
    /** Advance rack-slide and door animations. dt in seconds. */
    update(dt) {
      lower.update(dt);
      upper.update(dt);
      door.update(dt);
      for (const a of arms) a.mesh.rotation.y += a.speed * dt;
    },
  };
  loadShellOverride(dw);
  return dw;
}

/* ------------------------------- shell -------------------------------- */
function buildShell(root) {
  const g = new THREE.Group();
  g.name = 'shell';

  const W = 0.598, D = 0.575, H = 0.855;
  const wallT = 0.024;
  const box = (w, h, d, x, y, z, m = steel) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // carcass: sides, top, back, plinth
  box(wallT, H, D, -W / 2 + wallT / 2, H / 2, -0.29 + D / 2, steelDark);
  box(wallT, H, D, W / 2 - wallT / 2, H / 2, -0.29 + D / 2, steelDark);
  box(W, 0.018, D, 0, H - 0.009, -0.29 + D / 2, steelDark);
  box(W, H, 0.018, 0, H / 2, -0.29 + 0.009, steelDark);
  box(W, TUB.y0 - 0.02, D * 0.9, 0, (TUB.y0 - 0.02) / 2, -0.26 + D * 0.45, plasticMat);

  /* Tub liner, so you cannot see through the machine from the side. The geometry is
     built in world coordinates, so the mesh must sit at the origin — offsetting it as
     well put the liner's floor panel at upper-rack height, a solid slab through which
     anything on the top shelf appeared to stick out. */
  const liner = new THREE.Mesh(openBoxGeometry(TUB.w, TUB.h, TUB.d), tubMat);
  liner.receiveShadow = true;
  g.add(liner);

  // sump well in the tub floor
  const sump = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.03, 24), steelDark);
  sump.position.set(0, TUB.y0 - 0.014, -0.02);
  g.add(sump);

  root.add(g);
  return g;
}

/** A box with the +Z face removed, so we can see into the tub. World coordinates. */
function openBoxGeometry(w, h, d) {
  const parts = [];
  const t = 0.006;
  const add = (gw, gh, gd, x, y, z) => {
    const bg = new THREE.BoxGeometry(gw, gh, gd);
    bg.translate(x, y, z);
    parts.push(bg);
  };
  const cy = TUB.y0 + h / 2, cz = (TUB.z0 + TUB.z1) / 2;
  add(w, t, d, 0, TUB.y0 + t / 2, cz);              // floor
  add(w, t, d, 0, TUB.y0 + h - t / 2, cz);          // ceiling
  add(t, h, d, -w / 2 + t / 2, cy, cz);             // left
  add(t, h, d, w / 2 - t / 2, cy, cz);              // right
  add(w, h, t, 0, cy, TUB.z0 + t / 2);              // back
  return mergeGeometries(parts);
}

/* ------------------------------ tub bodies ------------------------------ */
function buildTubBodies(world) {
  const t = 0.06;   // thick static walls: nothing tunnels through these
  const add = (parts) => {
    const b = makeBody({ parts, mass: 0, material: MAT.tub });
    world.addBody(b);
    return b;
  };
  const cz = (TUB.z0 + TUB.z1) / 2, cy = TUB.y0 + TUB.h / 2;
  add([partBox(TUB.w + t * 2, t, TUB.d + t, [0, TUB.y0 - t / 2, cz])]);                    // floor
  add([partBox(TUB.w + t * 2, t, TUB.d + t, [0, TUB.y1 + t / 2, cz])]);                    // ceiling
  add([partBox(t, TUB.h + t * 2, TUB.d + t, [TUB.x0 - t / 2, cy, cz])]);                   // left
  add([partBox(t, TUB.h + t * 2, TUB.d + t, [TUB.x1 + t / 2, cy, cz])]);                   // right
  add([partBox(TUB.w + t * 2, TUB.h + t * 2, t, [0, cy, TUB.z0 - t / 2])]);                // back
  // hub of the lower spray arm — you cannot rest anything on the arm itself
  add([partCylinder(0.045, 0.05, 0.03, [0, TUB.y0 + 0.02, -0.02])]);
}

/* -------------------------------- door -------------------------------- */
function buildDoor(root, world) {
  const pivot = new THREE.Group();
  pivot.position.set(0, TUB.y0, TUB.z1 + 0.019);
  root.add(pivot);

  const W = 0.598, H = 0.72, T = 0.032;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), steel);
  panel.position.set(0, H / 2, T / 2);
  panel.castShadow = true; panel.receiveShadow = true;
  pivot.add(panel);

  // inner face is the pale liner, not steel
  const inner = new THREE.Mesh(new THREE.BoxGeometry(TUB.w - 0.01, H - 0.06, 0.004), tubMat);
  inner.position.set(0, H / 2, -0.003);
  pivot.add(inner);

  // detergent dispenser
  const disp = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.085, 0.008), plasticMat);
  disp.position.set(-0.09, H * 0.62, -0.006);
  pivot.add(disp);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.01, 20), glossBlack);
  cup.rotation.x = Math.PI / 2;
  cup.position.set(-0.09, H * 0.62, -0.012);
  pivot.add(cup);

  // control strip along the top edge of the door — unbranded
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.01, 0.055, 0.006), glossBlack);
  strip.position.set(0, H - 0.03, T + 0.002);
  pivot.add(strip);
  for (let i = 0; i < 5; i++) {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 14), steel);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(-0.12 + i * 0.05, H - 0.03, T + 0.006);
    pivot.add(btn);
  }
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.018),
    new THREE.MeshBasicMaterial({ color: 0x2ad0ff }));
  display.position.set(0.19, H - 0.03, T + 0.006);
  pivot.add(display);

  // recessed bar handle
  const handle = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.022, 0.028), steelDark);
  handle.position.set(0, H - 0.075, T + 0.012);
  pivot.add(handle);

  const body = makeBody({
    parts: [partBox(W, H, T, [0, H / 2, T / 2])],
    mass: 0, type: CANNON.Body.KINEMATIC, material: MAT.tub,
  });
  body.position.set(pivot.position.x, pivot.position.y, pivot.position.z);
  world.addBody(body);

  // +X rotation swings the top of the door forward and down, into a flat shelf
  const OPEN = Math.PI / 2;
  const state = { target: OPEN, speed: 1.6, w: 0 };
  const ANG_ACCEL = 4.0;

  /* Same rule as the racks: the physics body is the authority. Cannon integrates a
     kinematic body's angular velocity, so writing the quaternion as well would move
     the door twice and snatch it back each frame. */
  const currentAngle = () => 2 * Math.atan2(body.quaternion.x, body.quaternion.w);

  function setAngle(a) {
    pivot.rotation.x = a;
    body.quaternion.setFromEuler(a, 0, 0);
    body.angularVelocity.set(0, 0, 0);
  }

  const api = {
    pivot, body, OPEN, CLOSED: 0,
    get angle() { return currentAngle(); },
    get isClosed() { return currentAngle() < 0.02; },
    get isMoving() {
      return Math.abs(state.target - currentAngle()) > 0.005 || Math.abs(state.w) > 0.02;
    },
    open() { state.target = OPEN; },
    close() { state.target = 0; },
    setSpeed(sp) { state.speed = sp; },
    /** Jump straight to open or shut, no animation. */
    snapTo(open) {
      state.target = open ? OPEN : 0;
      state.w = 0;
      setAngle(state.target);
    },
    update(dt) {
      const a = currentAngle();
      const diff = state.target - a;
      // same reasoning as the racks: stop on distance, not on speed
      if (Math.abs(diff) <= Math.max(Math.abs(state.w) * dt, 0.004)) {
        state.w = 0;
        setAngle(state.target);
        return;
      }
      const dir = Math.sign(diff) || 1;
      const cruise = Math.min(state.speed, Math.sqrt(2 * ANG_ACCEL * Math.abs(diff)));
      state.w += THREE.MathUtils.clamp(cruise * dir - state.w, -ANG_ACCEL * dt, ANG_ACCEL * dt);
      body.angularVelocity.set(state.w, 0, 0);
      body.wakeUp();
      pivot.rotation.x = a;                 // graphics track the body
    },
  };

  api.snapTo(true);      // starts open, and update() would short-circuit before posing it
  return api;
}

/* -------------------------------- racks -------------------------------- */
function buildRack(root, world, name, cfg) {
  const group = new THREE.Group();
  group.name = `rack-${name}`;
  root.add(group);

  const zHome = (TUB.z0 + TUB.z1) / 2;
  const halfW = cfg.w / 2, halfD = cfg.d / 2;
  const rods = [];
  const rod = (len, x, y, z, axis) => {
    const gm = new THREE.CylinderGeometry(0.0022, 0.0022, len, 6, 1);
    if (axis === 'x') gm.rotateZ(Math.PI / 2);
    if (axis === 'z') gm.rotateX(Math.PI / 2);
    gm.translate(x, y, z);
    rods.push(gm);
  };

  // ---- base grid
  for (let x = -halfW + 0.02; x <= halfW - 0.02 + 1e-6; x += 0.042) rod(cfg.d, x, 0, 0, 'z');
  for (let z = -halfD + 0.02; z <= halfD - 0.02 + 1e-6; z += 0.042) rod(cfg.w, 0, 0.004, z, 'x');

  // ---- rim
  const r = cfg.rim;
  rod(cfg.w, 0, r, -halfD, 'x'); rod(cfg.w, 0, r, halfD, 'x');
  rod(cfg.d, -halfW, r, 0, 'z'); rod(cfg.d, halfW, r, 0, 'z');
  for (let x = -halfW; x <= halfW + 1e-6; x += 0.063) {
    for (const z of [-halfD, halfD]) rod(r, x, r / 2, z, 'y');
  }
  for (let z = -halfD + 0.05; z <= halfD - 0.05; z += 0.063) {
    for (const x of [-halfW, halfW]) rod(r, x, r / 2, z, 'y');
  }

  const baseMesh = new THREE.Mesh(mergeGeometries(rods), wireMat);
  baseMesh.castShadow = true; baseMesh.receiveShadow = true;
  group.add(baseMesh);

  // ---- tines (coated wire, so they read as a different part)
  const tineGeos = [];
  const ex = cfg.tineExclude;
  const excluded = (x, z) => ex && x > ex.x0 && x < ex.x1 && z > ex.z0 && z < ex.z1;
  for (const z of cfg.tineRows) {
    for (const x of cfg.tineXs) {
      if (excluded(x, z)) continue;
      const gm = new THREE.CylinderGeometry(0.0028, 0.0032, cfg.tineHeight, 6, 1);
      gm.translate(x, cfg.tineHeight / 2, z);
      tineGeos.push(gm);
    }
    // the wire that links each row, in the segments the basket well leaves free
    for (const [a, b] of rowSpans(cfg, z)) {
      const link = new THREE.CylinderGeometry(0.0028, 0.0028, b - a, 6, 1);
      link.rotateZ(Math.PI / 2);
      link.translate((a + b) / 2, cfg.tineHeight - 0.004, z);
      tineGeos.push(link);
    }
  }
  const tineMesh = new THREE.Mesh(mergeGeometries(tineGeos), wireCoat);
  tineMesh.castShadow = true;
  group.add(tineMesh);

  // ---- runners
  for (const x of [-halfW - 0.008, halfW + 0.008]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, cfg.d * 0.98), steelDark);
    rail.position.set(x, 0.006, 0);
    group.add(rail);
  }

  /* ---- physics: one body for the deck, one per tine row, one for the rim.
     Splitting them keeps the broadphase AABBs tight — a single 70-shape compound
     would force a narrowphase test against every tine for every nearby dish. */
  const bodies = [];
  const addBody = (parts) => {
    const b = makeBody({ parts, mass: 0, type: CANNON.Body.KINEMATIC, material: MAT.rack });
    world.addBody(b);
    bodies.push(b);
    return b;
  };

  addBody([partBox(cfg.w, 0.012, cfg.d, [0, -0.004, 0])]);                                   // deck
  addBody([                                                                                   // rim
    partBox(cfg.w, r, 0.008, [0, r / 2, -halfD]),
    partBox(cfg.w, r, 0.008, [0, r / 2, halfD]),
    partBox(0.008, r, cfg.d, [-halfW, r / 2, 0]),
    partBox(0.008, r, cfg.d, [halfW, r / 2, 0]),
  ]);
  /* Collision for a tine row is one thin wall per half-row, not nine separate prongs.
     Visually the prongs are still individual wires; for physics a wall does the same
     job — it is the slot between rows that holds a plate, not the gaps between prongs
     within a row — and it takes the machine from ~90 collision shapes down to ~20.
     Narrowphase, not the solver, is what a full load costs, so this is the single
     biggest thing in the file. Splitting each row in two keeps the AABBs tight, so a
     dish on the left of the rack never gets tested against the right. */
  /* Only tines tall enough to actually hold something get collision. The upper rack's
     are decorative nubs; giving them shapes turns the deck into a bed of nails, and a
     tumbler rim seven centimetres across ends up balanced on one or two of them. */
  for (const z of cfg.tineHeight >= 0.012 ? cfg.tineRows : []) {
    for (const [a, b] of rowSpans(cfg, z)) {
      // split anything wider than a hand's breadth, to keep the broadphase AABBs tight
      const pieces = Math.max(1, Math.round((b - a) / 0.24));
      for (let i = 0; i < pieces; i++) {
        const x0 = a + ((b - a) * i) / pieces;
        const x1 = a + ((b - a) * (i + 1)) / pieces;
        addBody([partBox(x1 - x0, cfg.tineHeight, 0.007, [(x0 + x1) / 2, cfg.tineHeight / 2, z])]);
      }
    }
  }

  const state = { target: name === 'lower' ? 1 : 0, speed: 0.55, v: 0 };
  const zAt = (t) => zHome + t * cfg.travel;
  /* Racks ease in and out rather than snapping to speed. A rack carries its load by
     friction alone, and friction can only accelerate a mug at about mu*g; jump
     straight to full speed and the rack slides out from under everything on it. At
     2 m/s^2 there is a wide margin. */
  const ACCEL = 2.0;

  /** Put everything exactly at t and stop it dead. Only for teleports and settling. */
  function snapPositions(t) {
    const z = zAt(t);
    group.position.set(0, cfg.y, z);
    for (const b of bodies) { b.position.set(0, cfg.y, z); b.velocity.set(0, 0, 0); }
    for (const e of api.extras) { e.sync(0, cfg.y, z); e.setVelocity(0); }
  }

  const api = {
    name, cfg, group, bodies, zHome, extras: [],
    /* Position is read back from the physics body rather than kept alongside it.
       Cannon integrates kinematic bodies by their own velocity, so setting a velocity
       (which is what drags the load along by friction) AND writing a position each
       frame moves the rack twice and then yanks it back — the contact never survives
       long enough to build up any friction, and the rack slides out from under a mug
       that is sitting right on it. Physics moves the rack; everything else follows. */
    get t() { return (bodies[0].position.z - zHome) / cfg.travel; },
    get z() { return bodies[0].position.z; },
    get isOut() { return api.t > 0.5; },
    get isMoving() {
      return Math.abs(zAt(state.target) - bodies[0].position.z) > 0.0015 || Math.abs(state.v) > 0.015;
    },
    /** Deck surface height — everything on this rack should be above it. */
    get deckY() { return cfg.y; },
    slideOut() { state.target = 1; },
    slideIn() { state.target = 0; },
    setSpeed(sp) { state.speed = sp; },
    /** Jump straight in or out, no animation. */
    snapTo(t) { state.target = t; state.v = 0; snapPositions(t); },
    place() { snapPositions(state.target); },
    update(dt) {
      const z = bodies[0].position.z;
      const targetZ = zAt(state.target);
      const remaining = Math.abs(targetZ - z);

      /* Stop when one frame's travel would carry us to the mark. Testing the speed
         instead never terminates: the braking profile keeps velocity proportional to
         the square root of the distance left, so it approaches the target without
         ever going slow enough to satisfy a fixed speed threshold. */
      if (remaining <= Math.max(Math.abs(state.v) * dt, 0.0008)) {
        state.v = 0;
        snapPositions(state.target);
        return;
      }

      const dir = Math.sign(targetZ - z) || 1;
      // cruise at the rack's speed, but never faster than we can still brake from
      const cruise = Math.min(state.speed, Math.sqrt(2 * ACCEL * remaining));
      state.v += THREE.MathUtils.clamp(cruise * dir - state.v, -ACCEL * dt, ACCEL * dt);

      for (const b of bodies) { b.velocity.set(0, 0, state.v); b.wakeUp(); }
      for (const e of api.extras) e.setVelocity(state.v);
      group.position.set(0, cfg.y, z);      // graphics track the body, one frame behind
    },
  };
  api.place();
  return api;
}

/** The x spans of one tine row, with the cutlery basket's well cut out of it. */
function rowSpans(cfg, z) {
  const half = cfg.w * 0.47;
  const ex = cfg.tineExclude;
  if (!ex || z <= ex.z0 || z >= ex.z1) return [[-half, half]];
  const spans = [];
  if (ex.x0 > -half) spans.push([-half, Math.min(ex.x0, half)]);
  if (ex.x1 < half) spans.push([Math.max(ex.x1, -half), half]);
  return spans.filter(([a, b]) => b - a > 0.02);
}

/* --------------------------- cutlery basket --------------------------- */
function buildCutleryBasket(rackGroup, world, rack) {
  const W = 0.205, D = 0.076, H = 0.115;
  // hard against the front rail, so the floor behind it stays in one piece
  // far enough forward to keep the floor behind it whole, far enough back that a
  // knife standing in it still clears the door seal
  const local = new THREE.Vector3(-0.134, 0.0, 0.182);

  const g = new THREE.Group();
  g.position.copy(local);
  rackGroup.add(g);

  // slatted plastic walls
  const slats = [];
  const slat = (w, h, d, x, y, z) => {
    const bg = new THREE.BoxGeometry(w, h, d); bg.translate(x, y, z); slats.push(bg);
  };
  slat(W, 0.006, D, 0, 0.003, 0);
  for (let x = -W / 2 + 0.008; x <= W / 2 - 0.008; x += 0.017) {
    slat(0.007, H, 0.006, x, H / 2, -D / 2); slat(0.007, H, 0.006, x, H / 2, D / 2);
  }
  for (let z = -D / 2 + 0.008; z <= D / 2 - 0.008; z += 0.017) {
    slat(0.006, H, 0.007, -W / 2, H / 2, z); slat(0.006, H, 0.007, W / 2, H / 2, z);
  }
  slat(W, 0.006, 0.006, 0, H, -D / 2); slat(W, 0.006, 0.006, 0, H, D / 2);
  slat(0.006, 0.006, D, -W / 2, H, 0); slat(0.006, 0.006, D, W / 2, H, 0);
  // divider, so forks and knives don't all pile in one corner
  slat(0.005, H * 0.8, D, 0, H * 0.4, 0);

  const mesh = new THREE.Mesh(mergeGeometries(slats), plasticMat);
  mesh.castShadow = true;
  g.add(mesh);

  const parts = [
    ...partsOpenBox({ w: W, d: D, height: H, wall: 0.007, base: 0.006 }),
    partBox(0.006, H * 0.8, D, [0, H * 0.4, 0]),
  ];
  const body = makeBody({ parts, mass: 0, type: CANNON.Body.KINEMATIC, material: MAT.rack });
  world.addBody(body);

  const extra = {
    body,
    sync(x, y, z) { body.position.set(x + local.x, y + local.y, z + local.z); },
    setVelocity(vz) { body.velocity.set(0, 0, vz); body.wakeUp(); },
  };
  rack.extras.push(extra);
  rack.place();

  return { group: g, body, local, W, D, H, rack };
}

/* ----------------------------- spray arms ----------------------------- */
function buildSprayArms(root) {
  const out = [];
  SPRAY_ARMS.forEach((a, i) => {
    const g = new THREE.Group();
    g.position.set(0, a.y, -0.02);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.022, 16), plasticMat);
    g.add(hub);

    const blades = [];
    for (const sign of [-1, 1]) {
      const bg = new THREE.BoxGeometry(a.r * 0.98, 0.013, 0.026);
      bg.translate((sign * a.r) / 2, 0, 0);
      blades.push(bg);
    }
    const arm = new THREE.Mesh(mergeGeometries(blades), plasticMat);
    g.add(arm);

    // jet nozzles
    for (const sign of [-1, 1]) {
      for (let k = 0.3; k <= 0.95; k += 0.22) {
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 8), steelDark);
        n.position.set(sign * a.r * k, i === 2 ? -0.008 : 0.008, 0);
        g.add(n);
      }
    }
    root.add(g);
    out.push({ mesh: g, speed: (i === 1 ? -1.9 : 1.5), y: a.y, r: a.r, spinning: false });
  });
  return out;
}

/* -------------------- optional real-model override -------------------- */
/**
 * If assets/dishwasher.glb exists, use it for the outer shell instead of the
 * procedural carcass. The racks, door body and all collision geometry stay as they
 * are — a downloaded art model has no usable physics or rail information.
 */
function loadShellOverride(dw) {
  if (typeof document === 'undefined') return;      // headless test harness
  new GLTFLoader().load('./assets/dishwasher.glb', (gltf) => {
    const model = gltf.scene;
    // Scale so the model's width matches our 0.598 m carcass, then sit it on the floor.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.x > 0) {
      const s = 0.598 / size.x;
      model.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;
      model.position.x -= (box2.min.x + box2.max.x) / 2;
      model.position.z -= box2.max.z - (TUB.z1 + 0.05);
    }
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    dw.shell.visible = false;
    dw.root.add(model);
    dw.overrideModel = model;
    console.info('[dishwasher] using assets/dishwasher.glb for the shell');
  }, undefined, () => { /* no model supplied — procedural shell stands */ });
}
