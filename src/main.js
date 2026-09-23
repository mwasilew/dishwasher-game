/**
 * Dishwasher Packing — entry point and game state.
 */
import * as THREE from 'three';
import { createWorld as createRenderWorld } from './world.js';
import {
  CANNON, MAT, createWorld as createPhysicsWorld, makeBody, syncMeshToBody, bodyAABB,
} from './physics.js';
import { buildDishwasher, TUB, RACKS } from './dishwasher.js';
import { createDish, DISHES } from './dishes.js';
import { createGrabber } from './grab.js';
import { createCycle } from './validate.js';
import { LEVELS } from './levels.js';
import { planLevel } from './solver.js';
import { createUI, loadProgress, saveProgress } from './ui.js';
import * as sfx from './audio.js';

const canvas = document.getElementById('scene');
const view = createRenderWorld(canvas);
const world = createPhysicsWorld();
const dw = buildDishwasher(view.scene, world);

// the kitchen floor, so anything you fumble lands rather than falls forever
const floor = makeBody({ parts: [], mass: 0, material: MAT.tub });
floor.addShape(new CANNON.Plane());
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floor);

/* ------------------------------ game state ------------------------------ */
const game = {
  levelIndex: 0,
  level: LEVELS[0],
  dishes: [],
  queue: [],            // [{ id, remaining, total }]
  activeRack: 'lower',
  locked: false,        // true while a cycle runs
  fromQueue: new WeakMap(),
};

const cycle = createCycle({
  dw, dishes: game.dishes,
  onPhase: (t) => {
    ui.setPhase(t);
    if (t.startsWith('Washing')) sfx.startWash();
    else if (t.startsWith('Draining')) sfx.stopWash();
  },
});

const grabber = createGrabber({
  camera: view.camera, canvas, world, scene: view.scene, controls: view.controls,
  getDishes: () => (game.locked ? [] : game.dishes),
  onPickup: (dish) => {
    sfx.resumeAudio();
    ui.setHeldHint(true);
    grabber.setDeckY(dw.racks[game.activeRack].cfg.y + 0.006);
    clearFlag(dish);                    // picking it up counts as dealing with it
    highlight(dish, HELD_TINT);
  },
  onDrop: (dish) => {
    ui.setHeldHint(false);
    highlight(dish, baseTint(dish));
    setTimeout(() => checkDrop(dish), 700);
  },
  onHoverChange: (dish) => {
    for (const d of game.dishes) if (d !== dish) highlight(d, baseTint(d));
    if (dish) highlight(dish, HOVER_TINT);
  },
});

const ui = createUI({
  onPickQueue: (id) => pickFromQueue(id),
  onRun: () => runCycle(),
  onReset: () => loadLevel(game.levelIndex),
  onMenu: () => ui.showMenu(true),
  onAuto: () => autoLoad(),
  onRack: (name) => setActiveRack(name),
  onSelectLevel: (i) => { ui.showMenu(false); loadLevel(i); },
  onRetry: () => loadLevel(game.levelIndex),
  onFix: () => {
    const offenders = lastOffenders;
    // keep everything where it is; just show the player what to go and sort out
    const first = (offenders ?? []).find((d) => game.dishes.includes(d));
    if (first) {
      const rack = first.body.position.y > RACKS.upper.y - 0.02 ? 'upper' : 'lower';
      if (rack !== game.activeRack) setActiveRack(rack);
      camAnim.to.set(first.body.position.x, first.body.position.y + 0.06, first.body.position.z);
      camAnim.time = 0.9;
      camAnim.active = true;
    }
  },
  onNext: () => {
    if (game.levelIndex + 1 < LEVELS.length) loadLevel(game.levelIndex + 1);
    else ui.showMenu(true);
  },
});

/* ------------------------------ dish handling ------------------------------ */
function spawnDish(id, position) {
  const built = createDish(id);
  const def = built.def;

  // per-instance materials: hover tinting must not leak into every other plate
  built.mesh.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    o.castShadow = true;
    o.receiveShadow = true;
  });
  built.mesh.userData.dishRef = built;

  const body = makeBody({
    parts: built.parts,
    mass: def.mass,
    material: MAT.dish,
    position,
    linearDamping: 0.05,
    angularDamping: 0.14,
  });
  body.sleepSpeedLimit = 0.05;
  body.sleepTimeLimit = 0.5;

  const kind = sfx.kindForDish(def);
  let lastSound = 0;
  body.addEventListener('collide', (e) => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const now = performance.now();
    if (v < 0.32 || now - lastSound < 90) return;
    lastSound = now;
    sfx.clink(kind, Math.min(1, v / 2.2));
  });

  built.body = body;
  built.samples = sampleSurface(built.mesh, 9);

  view.scene.add(built.mesh);
  world.addBody(body);
  game.dishes.push(built);
  syncMeshToBody(built.mesh, body);
  return built;
}

function removeDish(dish) {
  const i = game.dishes.indexOf(dish);
  if (i >= 0) game.dishes.splice(i, 1);
  world.removeBody(dish.body);
  view.scene.remove(dish.mesh);
  dish.mesh.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.dispose();
  });
}

/** Even spread of surface points, used later for the spray-shadow test. */
function sampleSurface(group, count) {
  const pts = [];
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
  for (let i = 0; i < all.length && pts.length < count; i += step) pts.push(all[i]);
  return pts;
}

/* A dish the machine has complained about glows a dull red until you deal with it.
   Emissive tint rather than a swapped material, so a flagged plate is still obviously
   a plate — and it survives being nudged, dropped and picked up again. */
const FLAG_TINT = 0x7a1c10;
const HOVER_TINT = 0x123448;
const HELD_TINT = 0x2a5570;

function baseTint(dish) { return dish.flagged ? FLAG_TINT : 0x000000; }

function highlight(dish, hex) {
  dish.mesh.traverse((o) => {
    if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex);
  });
}

/** Mark exactly these dishes as the problem, and clear anything flagged before. */
function flagDishes(dishes = []) {
  const set = new Set(dishes.filter((d) => game.dishes.includes(d)));
  for (const d of game.dishes) {
    d.flagged = set.has(d);
    highlight(d, baseTint(d));
  }
  return set.size;
}

function clearFlag(dish) {
  if (!dish?.flagged) return;
  dish.flagged = false;
  highlight(dish, baseTint(dish));
}

/** A slow pulse, so a marked dish catches the eye in a rack full of white china. */
const _flagCol = new THREE.Color();
function pulseFlags(now) {
  const k = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.005));
  for (const d of game.dishes) {
    if (!d.flagged || grabber.held === d) continue;
    _flagCol.setHex(FLAG_TINT).multiplyScalar(k);
    d.mesh.traverse((o) => {
      if (o.isMesh && o.material.emissive) o.material.emissive.copy(_flagCol);
    });
  }
}

/* ------------------------------ the queue ------------------------------ */
function buildQueue(level) {
  const order = [];
  const counts = new Map();
  for (const [id, n] of level.items) {
    if (!counts.has(id)) { counts.set(id, 0); order.push(id); }
    counts.set(id, counts.get(id) + n);
  }
  return order.map((id) => ({ id, remaining: counts.get(id), total: counts.get(id) }));
}

function queueLeft() { return game.queue.reduce((s, e) => s + e.remaining, 0); }

function refreshQueue() {
  const left = ui.renderQueue(game.queue, grabber.held?.id);
  ui.setRunEnabled(left === 0 && !game.locked && game.dishes.length > 0);
}

function pickFromQueue(id) {
  if (game.locked) return;
  const entry = game.queue.find((e) => e.id === id);
  if (!entry || entry.remaining === 0) return;
  if (grabber.held) grabber.release();

  const rack = dw.racks[game.activeRack];
  const spawn = [
    (Math.random() - 0.5) * 0.08,
    rack.cfg.y + 0.34,
    rack.z + rack.cfg.d * 0.15,
  ];
  const dish = spawnDish(id, spawn);
  game.fromQueue.set(dish, id);
  entry.remaining--;

  grabber.grab(dish, { deckY: rack.cfg.y + 0.006, carryY: rack.cfg.y + 0.20 });
  refreshQueue();
}

function returnHeldToQueue() {
  const dish = grabber.held;
  if (!dish) return;
  grabber.release();
  returnDish(dish);
}

function returnDish(dish) {
  const id = game.fromQueue.get(dish) ?? dish.id;
  const entry = game.queue.find((e) => e.id === id);
  if (entry) entry.remaining++;
  removeDish(dish);
  refreshQueue();
}

/* ------------------------------ safety net ------------------------------ */
/**
 * Deep interpenetration can throw a body out at an absurd speed, and once a position
 * goes non-finite the NaN spreads into the render matrices and takes the page with it.
 * Cheap to check, and it turns a lost tab into a dish that reappears above the rack.
 */
function isSane(body) {
  const p = body.position;
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && body.velocity.lengthSquared() < 2500;      // 50 m/s
}

function rescue(dish) {
  if (grabber.held === dish) grabber.release();
  const rack = dw.racks[game.activeRack];
  const b = dish.body;
  b.velocity.set(0, 0, 0);
  b.angularVelocity.set(0, 0, 0);
  b.quaternion.set(0, 0, 0, 1);
  b.position.set((Math.random() - 0.5) * 0.06, rack.cfg.y + 0.30, rack.z);
  b.wakeUp();
  ui.showWarnings([`The ${dish.def.name.toLowerCase()} got away from us — try that again.`], true);
}

/* ------------------------------ feedback ------------------------------ */
function checkDrop(dish) {
  if (game.locked || !game.dishes.includes(dish) || grabber.held === dish) return;
  const msgs = [];
  const { key, rack, bb } = cycle.rackOf(dish);
  const name = dish.def.name.toLowerCase();

  if (bb.max.y < 0.10) {
    ui.showWarnings([`The ${name} went on the floor.`], true);
    returnDish(dish);
    return;
  }
  if (!key) {
    msgs.push(`The ${name} isn't sitting in a rack.`);
  } else {
    if (bb.max.y > rack.cfg.ceiling - 0.006) {
      msgs.push(key === 'lower'
        ? `The ${name} is too tall — it will foul the upper rack.`
        : `The ${name} won't clear the top spray arm.`);
    }
    if (dish.openVessel && cycle.openingDir(dish).y > -0.30) {
      msgs.push(`The ${name} is facing up. It will fill with water.`);
    }
    if (dish.def.belongs === 'upper' && key === 'lower') {
      msgs.push(`${dish.def.name} is safer in the upper rack.`);
    } else if (dish.def.belongs === 'lower' && key === 'upper') {
      msgs.push(`${dish.def.name} is too heavy for the upper rack.`);
    }
    const dz = rack.zHome - rack.z;
    if (bb.max.z + dz > TUB.z1 - 0.006) {
      msgs.push(`The ${name} sticks out — the door won't close on it.`);
    }
  }
  if (msgs.length) ui.showWarnings(msgs);
}

/* ------------------------------ racks ------------------------------ */
/* Switching racks glides the orbit target onto the one that just came out — the two
   decks are 30 cm apart, and without this the upper rack ends up at the top of the
   frame while you are still aiming at the lower one. */
const camAnim = { active: false, to: new THREE.Vector3(), time: 0 };
let lastOffenders = [];

function focusRack(name) {
  const rack = dw.racks[name];
  camAnim.to.set(0, rack.cfg.y + 0.11, rack.zHome + rack.cfg.travel * 0.55);
  camAnim.time = 0.85;
  camAnim.active = true;
}

function setActiveRack(name) {
  if (game.locked || game.activeRack === name) return;
  game.activeRack = name;
  dw.racks[name].slideOut();
  dw.racks[name === 'lower' ? 'upper' : 'lower'].slideIn();
  ui.setRack(name);
  focusRack(name);
  if (grabber.held) grabber.setDeckY(dw.racks[name].cfg.y + 0.006);
}

/* ------------------------------ levels ------------------------------ */
function loadLevel(i) {
  game.levelIndex = i;
  game.level = LEVELS[i];
  game.locked = false;

  if (grabber.held) grabber.release();
  for (const d of [...game.dishes]) removeDish(d);
  game.dishes.length = 0;
  lastOffenders = [];

  game.queue = buildQueue(game.level);
  game.activeRack = 'lower';
  dw.racks.lower.slideOut();
  dw.racks.upper.slideIn();
  dw.door.open();

  focusRack('lower');
  ui.setLevel(i);
  ui.setRack('lower');
  ui.showMenu(false);
  ui.showResult(null);
  refreshQueue();
  ui.showWarnings([game.level.hint]);
}

/* ------------------------------ the cycle ------------------------------ */
async function runCycle() {
  if (game.locked || cycle.running) return;
  if (queueLeft() > 0) {
    ui.showWarnings([`There ${queueLeft() === 1 ? 'is 1 item' : `are ${queueLeft()} items`} still on the side.`], true);
    return;
  }
  if (grabber.held) grabber.release();
  game.locked = true;
  ui.setRunEnabled(false);
  ui.showCycle(true, 'Checking the load…');

  let res;
  try {
    res = await cycle.run();
  } finally {
    sfx.stopWash();
  }

  ui.showCycle(false);

  let flagged = 0;
  if (res?.pass) {
    flagDishes([]);
    const progress = loadProgress();
    progress[game.levelIndex] = Math.max(progress[game.levelIndex] ?? 0, res.stars);
    saveProgress(progress);
  } else {
    /* Nothing is thrown away on a failure. The racks come back out with the load
       exactly as it was, the dishes at fault light up, and the player fixes those
       rather than packing the whole machine again from an empty rack. */
    dw.door.open();
    dw.racks[game.activeRack].slideOut();
    flagged = flagDishes(res?.offenders ?? []);
  }
  game.locked = false;
  lastOffenders = res?.offenders ?? [];
  ui.showResult(res, { isLast: game.levelIndex === LEVELS.length - 1, flagged });
  refreshQueue();
}

/* ------------------------------ keyboard ------------------------------ */
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();

  if (k === 'escape') {
    if (ui.helpOpen) return ui.showHelp(false);
    if (ui.resultOpen) return;
    if (grabber.held) return returnHeldToQueue();
    return ui.showMenu(!ui.menuOpen);
  }
  if (ui.menuOpen || ui.resultOpen || ui.helpOpen) return;

  switch (k) {
    case 'tab':
      e.preventDefault();
      setActiveRack(game.activeRack === 'lower' ? 'upper' : 'lower');
      break;
    case 'q': grabber.rotate.yaw(e.shiftKey ? 90 : 15); break;
    case 'e': grabber.rotate.yaw(e.shiftKey ? -90 : -15); break;
    case 'r':
      if (e.shiftKey) loadLevel(game.levelIndex);
      else grabber.rotate.tip(90);
      break;
    case 'f': grabber.rotate.flip(); break;
    case 'g': grabber.rotate.faceDown(); break;
    case 'backspace': e.preventDefault(); returnHeldToQueue(); break;
    case 'enter': runCycle(); break;
    case 'h': ui.showHelp(true); break;
    case 'a': autoLoad(); break;
    case ' ':
      e.preventDefault();
      if (grabber.held) grabber.release();
      break;
    default: break;
  }
}, { passive: false });

addEventListener('pointerdown', () => sfx.resumeAudio(), { once: true });

/* ------------------------------ the loop ------------------------------ */
world.fixedTimeStep = 1 / 120;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (camAnim.active) {
    camAnim.time -= dt;
    view.controls.target.lerp(camAnim.to, Math.min(1, dt * 4));
    if (camAnim.time <= 0) camAnim.active = false;
  }

  /* Cannon skips narrowphase entirely for a pair where one body is kinematic and the
     other is asleep. The racks are kinematic and a settled dish falls asleep in a
     third of a second — so without this, sliding a rack out from under a mug that had
     stopped moving generated no contact at all, and the mug was left hanging in the
     air while its shelf drove away. Anything the machine is about to move must be
     awake to feel it. */
  if (dw.racks.lower.isMoving || dw.racks.upper.isMoving || dw.door.isMoving) {
    for (const d of game.dishes) d.body.wakeUp();
  }

  pulseFlags(now);
  dw.update(dt);
  grabber.update(dt);
  cycle.tick(dt);
  cycle.applySpray(dt);

  /* Fixed 120 Hz with at most three catch-up steps: under a heavy load the machine
     runs a shade slow rather than stuttering or spiralling. */
  world.step(1 / 120, dt, 3);

  for (const d of game.dishes) {
    if (!isSane(d.body)) rescue(d);
    syncMeshToBody(d.mesh, d.body);
  }

  view.controls.update();
  view.renderer.render(view.scene, view.camera);
}

/* ------------------------------ auto-load ------------------------------ */
/**
 * Loads the whole level the way someone who is good at this would: plates on edge in
 * the tine rows, cutlery in the basket, pans face down on the floor behind them. It
 * clears whatever is in the machine first, because a plan only holds together if it
 * owns the whole rack.
 *
 * It is a packer, not a search — so it can be beaten. It aims for a load that passes,
 * not for three stars, and on the tighter levels it will tell you it had to put
 * something in the wrong rack.
 */
function autoLoad(onDone) {
  if (game.locked || autoLoad.running) return;
  if (grabber.held) grabber.release();

  for (const d of [...game.dishes]) removeDish(d);
  game.queue = buildQueue(game.level);
  dw.racks.lower.snapTo(0);
  dw.racks.upper.snapTo(0);
  dw.door.snapTo(true);
  ui.setRack('lower');
  game.activeRack = 'lower';
  focusRack('lower');

  const { placements, unplaced } = planLevel(game.level);
  autoLoad.running = true;
  ui.showWarnings(['Loading…']);

  let i = 0;
  const timer = setInterval(() => {
    if (i >= placements.length) {
      clearInterval(timer);
      autoLoad.running = false;
      refreshQueue();
      const msgs = unplaced.length
        ? [`${unplaced.length} item${unplaced.length === 1 ? '' : 's'} wouldn't fit — you'll have to find room.`]
        : ['Loaded. Press Enter to run it.'];
      ui.showWarnings(msgs, unplaced.length > 0);
      onDone?.();
      return;
    }
    const p = placements[i++];
    const rackZ = dw.racks[p.rack].z;
    const dish = spawnDish(p.id, [p.x, p.y, rackZ + p.z]);
    dish.body.quaternion.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    game.fromQueue.set(dish, p.id);
    const entry = game.queue.find((e) => e.id === p.id && e.remaining > 0);
    if (entry) entry.remaining--;
    if (i % 4 === 0) refreshQueue();
  }, 70);
}

/* ------------------------------ dev helpers ------------------------------ */
/**
 * ?fill=1 tips the whole queue into the racks from above, alternating decks.
 * It is not a solver and it will not pass a level — it exists to shake the physics
 * out under a full load, and to make it possible to look at a packed machine
 * without placing forty items by hand first.
 */
function autoFill() {
  const pending = [];
  for (const e of game.queue) for (let i = 0; i < e.remaining; i++) pending.push(e.id);
  for (const e of game.queue) e.remaining = 0;

  let i = 0;
  const timer = setInterval(() => {
    if (i >= pending.length) { clearInterval(timer); refreshQueue(); return; }
    const id = pending[i];
    const useUpper = i % 3 === 2;
    const rack = dw.racks[useUpper ? 'upper' : 'lower'];
    // Kept close to the centre line: the widest item in the catalogue is 44 cm and
    // the tub is 55 cm, so a generous spread starts things off inside the tub wall.
    const col = i % 3, row = Math.floor(i / 3) % 3;
    const dish = spawnDish(id, [
      -0.07 + col * 0.07 + (Math.random() - 0.5) * 0.02,
      rack.cfg.y + 0.16,
      rack.z - 0.11 + row * 0.11,
    ]);
    game.fromQueue.set(dish, id);
    if (dish.openVessel) dish.body.quaternion.setFromEuler(Math.PI, Math.random() * 3, 0);
    else dish.body.quaternion.setFromEuler(0, Math.random() * 3, 0);
    i++;
  }, 90);
}

/* ------------------------------ boot ------------------------------ */
const params = new URLSearchParams(location.search);
ui.hideLoading();

const deepLink = parseInt(params.get('level') ?? '', 10);
if (Number.isFinite(deepLink) && deepLink >= 1 && deepLink <= LEVELS.length) {
  loadLevel(deepLink - 1);
  ui.showMenu(false);
  if (params.get('fill')) autoFill();
  else if (params.get('auto')) {
    const thenRun = params.get('run') ? () => setTimeout(runCycle, 1600) : undefined;
    const delay = Math.min(30000, Math.max(0, parseInt(params.get('delay') ?? '400', 10) || 400));
    setTimeout(() => autoLoad(thenRun), delay);
  }
} else {
  loadLevel(0);
  ui.showMenu(true);
}
requestAnimationFrame(frame);

// handy for debugging and for the automated smoke test
window.__game = { game, world, dw, view, cycle, grabber, spawnDish, loadLevel, autoFill, autoLoad, runCycle, DISHES, RACKS, TUB, bodyAABB };
