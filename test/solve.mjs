/**
 * Runs the auto-loader on every level, settles the physics, and puts the result
 * through the same wash-cycle judgement the player gets. This is the only way to know
 * whether a level is actually winnable — the packer obeying its own rules proves
 * nothing until the dishes have been dropped and the machine has looked at them.
 *
 *   node test/solve.mjs [level]
 */
import * as THREE from '../vendor/three.module.js';
import { createWorld, makeBody, MAT, syncMeshToBody, CANNON } from '../src/physics.js';
import { buildDishwasher, RACKS } from '../src/dishwasher.js';
import { DISHES, createDish } from '../src/dishes.js';
import { LEVELS } from '../src/levels.js';
import { planLevel } from '../src/solver.js';
import { createCycle } from '../src/validate.js';

const only = process.argv[2] ? parseInt(process.argv[2], 10) - 1 : null;
let failures = 0;

const scene = new THREE.Scene();
const world = createWorld();
const dw = buildDishwasher(scene, world);
const dishes = [];
const cycle = createCycle({ dw, dishes, onPhase: () => {} });

function run(steps) {
  for (let i = 0; i < steps; i++) {
    if (dw.racks.lower.isMoving || dw.racks.upper.isMoving || dw.door.isMoving) {
      for (const d of dishes) d.body.wakeUp();
    }
    dw.update(1 / 120);
    cycle.tick(1 / 120);
    cycle.applySpray(1 / 120);
    world.step(1 / 120);
    for (const d of dishes) syncMeshToBody(d.mesh, d.body);
  }
}

function clear() {
  for (const d of dishes.splice(0)) {
    world.removeBody(d.body);
    scene.remove(d.mesh);
  }
}

function load(placements) {
  for (const p of placements) {
    const built = createDish(p.id);
    built.mesh.userData.dishRef = built;
    const rackZ = dw.racks[p.rack].z;
    const body = makeBody({
      parts: built.parts, mass: DISHES[p.id].mass, material: MAT.dish,
      position: [p.x, p.y, rackZ + p.z], linearDamping: 0.05, angularDamping: 0.14,
    });
    body.quaternion.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    built.body = body;
    built.samples = sampleSurface(built.mesh, 9);
    scene.add(built.mesh);
    world.addBody(body);
    dishes.push(built);
    syncMeshToBody(built.mesh, body);
  }
}

function sampleSurface(group, count) {
  const all = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / 24));
    for (let i = 0; i < pos.count; i += stride) {
      all.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrix));
    }
  });
  if (!all.length) return [new THREE.Vector3()];
  const step = Math.max(1, Math.floor(all.length / count));
  const pts = [];
  for (let i = 0; i < all.length && pts.length < count; i += step) pts.push(all[i]);
  return pts;
}

console.log('');
for (const [i, level] of LEVELS.entries()) {
  if (only !== null && i !== only) continue;

  clear();
  dw.racks.lower.snapTo(0);
  dw.racks.upper.snapTo(0);
  dw.door.snapTo(true);
  run(30);

  const plan = planLevel(level);
  load(plan.placements);
  run(420);                                  // let everything settle in the racks

  if (process.env.VERBOSE) {
    for (const d of dishes) {
      if (!d.openVessel) continue;
      const up = cycle.openingDir(d).y;
      if (up > -0.3) {
        const pl = plan.placements.find((q) => q.id === d.id);
        console.log(`   settled wrong: ${d.id} opening.y=${up.toFixed(2)} ` +
          `at (${d.body.position.x.toFixed(3)}, ${d.body.position.y.toFixed(3)}, ${d.body.position.z.toFixed(3)}) ` +
          `planned rack=${pl?.rack} y=${pl?.y.toFixed(3)} z=${pl?.z.toFixed(3)}`);
      }
    }
  }

  /* The cycle's own waits are advanced by cycle.tick, which only happens inside
     run() — so the world has to be pumped while the promise is pending, or the whole
     thing simply stops with nothing left to do. */
  let res = null, finished = false;
  // FULL=1 runs the cycle at the speed the player sees, spray and all
  cycle.run({ quick: !process.env.FULL }).then((r) => { res = r; finished = true; });
  for (let guard = 0; !finished && guard < 12000; guard += 4) {
    run(4);
    await new Promise(setImmediate);
  }
  if (!finished) { console.log(`level ${i + 1}: the wash cycle never finished`); failures++; continue; }
  const stars = res?.pass ? '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars) : '—  ';
  const total = level.items.reduce((s, [, n]) => s + n, 0);
  const head = `level ${String(i + 1).padStart(2)}  ${String(total).padStart(2)} items  ${stars}  ${level.name}`;

  if (plan.unplaced.length) {
    console.log(`${head}\n            ✗ packer left ${plan.unplaced.length} behind: ` +
      [...new Set(plan.unplaced.map((u) => `${DISHES[u.id].name} (${u.why})`))].join(', '));
    failures++;
  } else if (res?.pass) {
    console.log(head + (res.warn?.length ? `\n            · ${res.warn[0]}` : ''));
    for (const n of plan.notes) console.log(`            ~ ${n}`);
  } else {
    console.log(`${head}\n` + (res?.bad ?? ['no result']).slice(0, 3).map((b) => `            ✗ ${b}`).join('\n'));
    for (const n of plan.notes) console.log(`            ~ ${n}`);
    if (process.env.VERBOSE) {
      for (const d of dishes) {
        const p2 = d.body.position;
        const planned = plan.placements.find((q) => q.id === d.id);
        console.log(`              ${d.id.padEnd(14)} at (${p2.x.toFixed(3)}, ${p2.y.toFixed(3)}, ${p2.z.toFixed(3)})` +
          (planned ? `  planned z=${planned.z.toFixed(3)} y=${planned.y.toFixed(3)}` : ''));
      }
    }
    failures++;
  }

  dw.door.snapTo(true);
  dw.racks.lower.snapTo(0);
  dw.racks.upper.snapTo(0);
}

console.log(failures ? `\n${failures} level(s) the auto-loader cannot solve\n`
                     : '\nthe auto-loader solves every level\n');
process.exit(failures ? 1 : 0);
