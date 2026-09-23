/**
 * Headless smoke test: builds the machine and every dish in the catalogue, drops each
 * one into the lower rack and simulates. Catches broken compound shapes, NaN blow-ups
 * and dishes that are the wrong size for the racks — without needing a GPU.
 *
 *   node test/smoke.mjs
 */
import * as THREE from '../vendor/three.module.js';
import { createWorld, makeBody, MAT, bodyAABB, CANNON } from '../src/physics.js';
import { buildDishwasher, TUB, RACKS } from '../src/dishwasher.js';
import { DISHES, createDish } from '../src/dishes.js';
import { LEVELS, levelQueue } from '../src/levels.js';

let failures = 0;
const fail = (msg) => { console.log(`  ✗ ${msg}`); failures++; };
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Take every dish back out again — each section starts with an empty machine. */
function clearDishes(w) {
  for (const b of [...w.bodies]) if (b.mass > 0) w.removeBody(b);
}
function run(steps) {
  for (let i = 0; i < steps; i++) { dw.update(1 / 120); world.step(1 / 120); }
}

const scene = new THREE.Scene();
const world = createWorld();
const dw = buildDishwasher(scene, world);

console.log('\n— machine —');
{
  const rl = RACKS.lower, ru = RACKS.upper;
  const lowerClear = rl.ceiling - rl.y;
  const upperClear = ru.ceiling - ru.y;
  ok(`lower rack clearance ${(lowerClear * 100).toFixed(1)} cm, upper ${(upperClear * 100).toFixed(1)} cm`);
  if (lowerClear < 0.2) fail('lower rack clearance is unusably small');
  if (upperClear < 0.18) fail('upper rack clearance is unusably small');
  if (ru.y + 0.002 < rl.ceiling) fail('upper rack deck sits below the lower rack ceiling');
  const bodies = world.bodies.length;
  ok(`${bodies} static/kinematic bodies in the machine`);
  if (bodies > 60) fail(`too many machine bodies (${bodies}) — broadphase will suffer`);

  /* Nothing the shell draws may sit in the space the dishes occupy. The liner is
     built in world coordinates, and it was once *also* given a position, which put its
     floor panel at upper-rack height — a solid slab that anything on the top shelf
     appeared to stick out through. Physics never noticed, because the liner is
     decoration; only a geometric check like this one catches it. */
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const up = new THREE.Vector3(0, 1, 0);
  let blocked = 0, probes = 0;
  for (const key of ['lower', 'upper']) {
    const cfg = RACKS[key];
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const from = new THREE.Vector3(ix * cfg.w * 0.35, cfg.y + 0.01, iz * cfg.d * 0.35);
        ray.set(from, up);
        ray.far = cfg.ceiling - from.y;
        probes++;
        const hit = ray.intersectObject(dw.shell, true)[0];
        if (hit) {
          blocked++;
          fail(`solid shell geometry inside the ${key} rack at y=${hit.point.y.toFixed(3)} ` +
               `(x ${from.x.toFixed(2)}, z ${from.z.toFixed(2)}) — dishes will stick through it`);
        }
      }
    }
  }
  if (!blocked) ok(`${probes} probes through both racks: nothing solid in the way`);
}

console.log('\n— dish catalogue —');
const report = [];
for (const id of Object.keys(DISHES)) {
  const built = createDish(id);
  const def = DISHES[id];
  const size = built.size;

  if (![size.x, size.y, size.z].every(Number.isFinite)) { fail(`${id}: non-finite size`); continue; }
  if (Math.min(size.x, size.y, size.z) <= 0) { fail(`${id}: degenerate size ${size.toArray()}`); continue; }
  if (!built.parts.length) { fail(`${id}: no collision shapes`); continue; }
  for (const p of built.parts) {
    const o = p.offset;
    if (![o.x, o.y, o.z].every(Number.isFinite)) { fail(`${id}: non-finite shape offset`); break; }
  }

  const body = makeBody({ parts: built.parts, mass: def.mass, material: MAT.dish, position: [0, 0.9, 0.1] });
  const shapes = body.shapes.length;
  if (shapes > 30) fail(`${id}: ${shapes} collision shapes is too many`);

  // does it physically fit in a rack at all, in its most favourable orientation?
  const minDim = Math.min(size.x, size.y, size.z);
  const fitsLower = minDim < RACKS.lower.ceiling - RACKS.lower.y;
  const fitsUpper = size.y < RACKS.upper.ceiling - RACKS.upper.y;   // standing as spawned
  if (!fitsLower) fail(`${id}: ${(minDim * 100).toFixed(1)} cm thinnest axis will not fit the lower rack`);
  const widest = Math.max(size.x, size.z);
  if (widest > RACKS.lower.w) fail(`${id}: ${(widest * 100).toFixed(1)} cm wider than the rack (${RACKS.lower.w * 100} cm)`);

  report.push({
    id, shapes,
    dims: [size.x, size.y, size.z].map((v) => (v * 100).toFixed(1)).join('×'),
    fits: `${fitsLower ? 'L' : '-'}${fitsUpper ? 'U' : '-'}`,
  });
}
console.log(report.map((r) => `  ${r.id.padEnd(16)} ${r.dims.padStart(16)} cm  ${r.shapes.toString().padStart(2)} shapes  fits:${r.fits}`).join('\n'));

console.log('\n— simulation —');
{
  /* One dish at a time, dropped into the middle of the lower rack. Centred, because
     the widest item in the catalogue is 44 cm across and the tub is 55 cm — spawn it
     off to one side and it starts life inside the tub wall, which proves nothing
     except that penetration resolution is violent. One at a time is also far faster
     than a pile-up: the cost is in dish-on-dish contacts, not dish-on-rack. */
  const rack = dw.racks.lower;
  rack.slideIn();
  run(120);

  let checked = 0, trouble = 0;
  for (const id of Object.keys(DISHES)) {
    clearDishes(world);
    const built = createDish(id);
    const body = makeBody({
      parts: built.parts, mass: DISHES[id].mass, material: MAT.dish,
      position: [0, rack.cfg.y + 0.24, rack.z - 0.02],
    });
    body.quaternion.setFromEuler(Math.PI, 0.4, 0);        // upside down and skewed
    world.addBody(body);
    run(260);

    const p = body.position;
    checked++;
    if (![p.x, p.y, p.z].every(Number.isFinite)) { trouble++; fail(`${id}: NaN position`); }
    else if (p.y < 0.05) { trouble++; fail(`${id}: fell out of the machine (y=${p.y.toFixed(2)})`); }
    else if (Math.abs(p.x) > 0.6 || Math.abs(p.z) > 0.6) { trouble++; fail(`${id}: was thrown clear (${p.x.toFixed(2)},${p.z.toFixed(2)})`); }
    else if (p.y > 1.2) { trouble++; fail(`${id}: launched upwards (y=${p.y.toFixed(2)})`); }
  }
  clearDishes(world);
  if (!trouble) ok(`all ${checked} dishes dropped into the rack and stayed there`);
}

console.log('\n— plates in the tine rows —');
{
  /* The whole lower rack is designed around this: a plate stood on edge between two
     rows of tines has to stay there. If plates roll over, the game has no puzzle. */
  clearDishes(world);
  const rack = dw.racks.lower;
  rack.slideIn();
  run(60);

  const gaps = [-0.150, -0.100, -0.050, 0.000, 0.050];   // midway between tine rows
  const plates = [];
  for (const z of gaps) {
    const built = createDish('dinner-plate');
    const body = makeBody({
      parts: built.parts, mass: DISHES['dinner-plate'].mass, material: MAT.dish,
      position: [0, rack.cfg.y + built.radius + 0.012, rack.z + z],
    });
    body.quaternion.setFromEuler(Math.PI / 2, 0, 0);     // face across the rows
    world.addBody(body);
    plates.push({ z, body });
  }
  run(700);

  let fallen = 0, strayed = 0;
  for (const { z, body } of plates) {
    const q = body.quaternion;
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    const lean = Math.abs(n.y);                          // 0 = perfectly upright, 1 = flat
    const drift = Math.abs(body.position.z - (rack.z + z));
    if (lean > 0.5) { fallen++; fail(`plate at z=${z} fell flat (lean ${lean.toFixed(2)})`); }
    else if (drift > 0.06) { strayed++; fail(`plate at z=${z} slid ${(drift * 100).toFixed(1)} cm out of its slot`); }
  }
  if (!fallen && !strayed) ok(`${plates.length} plates stood on edge in the tine rows for ~6 s`);
}

console.log('\n— cutlery in the basket —');
{
  clearDishes(world);
  const basket = dw.cutlery;
  const rack = dw.racks.lower;
  const world0 = new THREE.Vector3(basket.local.x, rack.cfg.y + basket.local.y, rack.z + basket.local.z);
  const items = [];
  for (const [i, id] of ['fork', 'knife', 'spoon', 'teaspoon', 'fork', 'spoon'].entries()) {
    const built = createDish(id);
    const body = makeBody({
      parts: built.parts, mass: DISHES[id].mass, material: MAT.dish,
      position: [world0.x - 0.06 + (i % 3) * 0.045, world0.y + 0.16, world0.z + (i < 3 ? -0.025 : 0.025)],
    });
    body.quaternion.setFromEuler(Math.PI / 2, 0, 0);     // handle down, like you would
    world.addBody(body);
    items.push({ id, body });
  }
  run(600);

  let out = 0;
  for (const { id, body } of items) {
    const dx = Math.abs(body.position.x - world0.x);
    const dz = Math.abs(body.position.z - world0.z);
    if (dx > basket.W / 2 + 0.05 || dz > basket.D / 2 + 0.06) { out++; fail(`${id} ended up outside the cutlery basket`); }
  }
  if (!out) ok(`${items.length} pieces of cutlery stayed in the basket`);
}

clearDishes(world);

console.log('\n— moving parts —');
{
  /* The bug this guards against: a mug settled in the upper rack stayed exactly where
     it was while the rack slid out from under it. Two causes, both worth a permanent
     test. Cannon's integrator skips sleeping bodies, and makeBody used to let every
     body sleep — so a kinematic rack that had been still for a third of a second
     refused to move at all. And a dish that is itself asleep generates no contact with
     a kinematic body, so it feels nothing when its shelf drives away. */
  dw.racks.upper.snapTo(1); dw.racks.lower.snapTo(0); dw.door.snapTo(true);
  run(60);

  const built = createDish('mug');
  const mug = makeBody({
    parts: built.parts, mass: DISHES.mug.mass, material: MAT.dish,
    position: [0.04, RACKS.upper.y + 0.05, dw.racks.upper.z - 0.04],
  });
  mug.quaternion.setFromEuler(Math.PI, 0, 0);
  world.addBody(mug);
  run(600);                                   // settle, and let it doze off

  const relBefore = mug.position.z - dw.racks.upper.z;
  dw.racks.upper.slideIn();
  let n = 0;
  while (dw.racks.upper.isMoving && n < 1500) {
    mug.wakeUp();                             // exactly what the game loop does
    run(1); n++;
  }
  n < 1500 ? ok(`upper rack stopped after ${(n / 120).toFixed(2)} s`)
           : fail('upper rack never stopped moving');
  run(120);

  const slip = Math.abs((mug.position.z - dw.racks.upper.z) - relBefore);
  const stillUp = mug.position.y > RACKS.upper.y;
  (slip < 0.05 && stillUp)
    ? ok(`the mug rode the rack in, slipping ${(slip * 100).toFixed(1)} cm`)
    : fail(`the mug did not ride the rack: slipped ${(slip * 100).toFixed(1)} cm, ` +
           `${stillUp ? 'still up top' : `fell to y=${mug.position.y.toFixed(2)}`}`);

  dw.door.close();
  n = 0;
  while (dw.door.isMoving && n < 1500) { run(1); n++; }
  (n < 1500 && dw.door.isClosed)
    ? ok(`the door shut in ${(n / 120).toFixed(2)} s`)
    : fail(`the door never shut (angle ${dw.door.angle.toFixed(3)} after ${n} steps)`);

  dw.door.snapTo(true);
  clearDishes(world);
}

console.log('\n— performance —');
{
  /* Narrowphase, not the solver, is what a full machine costs, and it scales with how
     tightly the load is packed. Two loads are timed: a middling one and the worst the
     game will ever ask for. Anything under about 8 ms a step leaves room to render at
     60 fps with two physics steps a frame. */
  const spread = (ids) => {
    const bodies = [];
    let li = 0, ui = 0;
    for (const id of ids) {
      const def = DISHES[id];
      const upper = def.belongs === 'upper' || def.belongs === 'basket';
      const rack = upper ? dw.racks.upper : dw.racks.lower;
      const i = upper ? ui++ : li++;
      const built = createDish(id);
      const body = makeBody({
        parts: built.parts, mass: def.mass, material: MAT.dish,
        position: [-0.19 + (i % 5) * 0.095, rack.cfg.y + 0.05 + built.size.y / 2,
          rack.z - 0.16 + Math.floor(i / 5) * 0.10],
      });
      body.quaternion.setFromEuler(Math.PI, i * 0.7, 0);
      world.addBody(body);
      bodies.push(body);
      run(6);
    }
    return bodies;
  };

  const time = (steps) => {
    const t0 = process.hrtime.bigint();
    run(steps);
    return Number(process.hrtime.bigint() - t0) / 1e6 / steps;
  };

  dw.racks.lower.slideIn(); dw.racks.upper.slideIn();
  let slow = 0;
  for (const idx of [7, LEVELS.length - 1]) {
    clearDishes(world);
    run(60);
    const ids = levelQueue(LEVELS[idx]);
    const bodies = spread(ids);
    run(900);
    const shapes = bodies.reduce((n, b) => n + b.shapes.length, 0);
    const ms = time(150);
    const asleep = bodies.filter((b) => b.sleepState === 2).length;
    console.log(`  level ${String(idx + 1).padStart(2)}  ${String(ids.length).padStart(2)} dishes, ` +
      `${String(shapes).padStart(3)} shapes, ${String(world.contacts.length).padStart(3)} contacts, ` +
      `${String(asleep).padStart(2)}/${bodies.length} asleep  ${ms.toFixed(2)} ms/step`);
    /* Wall-clock, so it is a guard against order-of-magnitude regressions rather than
       a budget: on an unloaded machine these come in around 3 ms and 6 ms. */
    if (ms > 15) { slow++; fail(`level ${idx + 1} costs ${ms.toFixed(1)} ms/step — far slower than expected`); }
  }
  clearDishes(world);
  if (!slow) ok('a full machine steps fast enough to render at 60 fps');
}

console.log('\n— levels —');
for (const [i, lv] of LEVELS.entries()) {
  const q = levelQueue(lv);
  const unknown = q.filter((id) => !DISHES[id]);
  if (unknown.length) fail(`level ${i + 1} references unknown dishes: ${[...new Set(unknown)].join(', ')}`);
  // rough volume budget: the two racks hold about 63 litres of usable space
  let vol = 0;
  for (const id of q) {
    const b = createDish(id);
    vol += b.size.x * b.size.y * b.size.z;
  }
  const cap = (RACKS.lower.w * RACKS.lower.d * (RACKS.lower.ceiling - RACKS.lower.y))
            + (RACKS.upper.w * RACKS.upper.d * (RACKS.upper.ceiling - RACKS.upper.y));
  const pct = (vol / cap) * 100;
  const line = `  level ${String(i + 1).padStart(2)}  ${String(q.length).padStart(2)} items  ${pct.toFixed(0).padStart(3)}% of bounding-box capacity  ${lv.name}`;
  console.log(line);
  if (pct > 95) fail(`level ${i + 1} is over capacity (${pct.toFixed(0)}%) — probably unsolvable`);
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);
