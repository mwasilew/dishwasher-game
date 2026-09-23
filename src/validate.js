/**
 * The wash cycle — and the judgement.
 *
 * Two honest checks bracket the animation. Before anything moves we measure the load
 * geometrically: is everything actually in a rack, will it clear the rack above, does
 * anything hang below the deck into the spray arm, and once the racks roll home will
 * anything still be proud of the door seal. Then the machine really does close and
 * really does run — the dishes get buffeted by the spray — and afterwards we look at
 * where things ended up: what is facing the wrong way, what fell, and what is standing
 * in the water's way.
 */
import * as THREE from 'three';
import { TUB, RACKS, SPRAY_ARMS } from './dishwasher.js';
import { bodyAABB, CANNON } from './physics.js';

const TOL = 0.006;

export function createCycle({ dw, dishes, onPhase }) {
  const timers = [];
  const conditions = [];

  function tick(dt) {
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= dt;
      if (timers[i].t <= 0) { timers.splice(i, 1)[0].resolve(); }
    }
    for (let i = conditions.length - 1; i >= 0; i--) {
      const c = conditions[i];
      c.timeout -= dt;
      if (c.fn() || c.timeout <= 0) { conditions.splice(i, 1); c.resolve(); }
    }
  }
  const sleep = (s) => new Promise((resolve) => timers.push({ t: s, resolve }));
  const until = (fn, timeout = 5) => new Promise((resolve) => conditions.push({ fn, timeout, resolve }));

  /* ---------------------------- geometry ---------------------------- */

  /** Which rack is this dish riding on — if any? */
  function rackOf(dish) {
    const bb = bodyAABB(dish.body);
    for (const key of ['upper', 'lower']) {
      const rack = dw.racks[key];
      const c = rack.cfg;
      if (bb.min.y < c.y - 0.018) continue;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      if (Math.abs(cx) > c.w / 2 + 0.03) continue;
      if (Math.abs(cz - rack.z) > c.d / 2 + 0.05) continue;
      if (key === 'lower' && bb.min.y > RACKS.upper.y - 0.02) continue;   // it's up top, not down here
      return { key, rack, bb };
    }
    return { key: null, rack: null, bb };
  }

  /** Direction the opening faces, in world space. */
  function openingDir(dish) {
    const q = dish.body.quaternion;
    return new THREE.Vector3(0, 1, 0)
      .applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  }

  /* ---------------------------- pre-flight ---------------------------- */
  function preflight() {
    const issues = [];
    const seen = new Set();
    const note = (kind, dish, text) => {
      const key = `${kind}:${dish.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({ kind, dish, text });
    };

    for (const dish of dishes) {
      const { key, rack, bb } = rackOf(dish);
      if (!key) {
        note('stray', dish, `The ${low(dish.def.name)} isn't in either rack.`);
        continue;
      }
      const c = rack.cfg;
      if (bb.max.y > c.ceiling - TOL) {
        note('tall', dish, key === 'lower'
          ? `The ${low(dish.def.name)} stands too tall — it will hit the upper rack.`
          : `The ${low(dish.def.name)} won't clear the top spray arm.`);
      }
      if (bb.min.y < c.y - 0.020) {
        note('below', dish, `The ${low(dish.def.name)} hangs below the rack and will jam the spray arm.`);
      }
      const dz = rack.zHome - rack.z;           // where it will be once the rack rolls home
      if (bb.max.z + dz > TUB.z1 - TOL) {
        note('proud', dish, `The ${low(dish.def.name)} sticks out too far — the door won't shut on it.`);
      }
      if (bb.min.x < TUB.x0 + TOL || bb.max.x > TUB.x1 - TOL) {
        note('wide', dish, `The ${low(dish.def.name)} is jammed against the side of the tub.`);
      }
    }
    return issues;
  }

  /* --------------------------- spray coverage --------------------------- */
  function armFor(y) {
    let best = SPRAY_ARMS[0];
    for (const a of SPRAY_ARMS) if (a.y < y - 0.01 && a.y > best.y) best = a;
    return best;
  }

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = false;

  function coverage(dish, others) {
    if (!dish.samples?.length) return 1;
    dish.mesh.updateMatrixWorld(true);
    const bb = bodyAABB(dish.body);
    const arm = armFor((bb.min.y + bb.max.y) / 2);
    const armPts = [
      new THREE.Vector3(0, arm.y, -0.02),
      new THREE.Vector3(arm.r * 0.62, arm.y, -0.02),
      new THREE.Vector3(-arm.r * 0.62, arm.y, -0.02),
    ];
    let hitFree = 0, total = 0;
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (const s of dish.samples) {
      p.copy(s).applyMatrix4(dish.mesh.matrixWorld);
      for (const ap of armPts) {
        total++;
        dir.copy(ap).sub(p);
        const dist = dir.length();
        if (dist < 1e-4) { hitFree++; continue; }
        dir.multiplyScalar(1 / dist);
        ray.set(p.clone().addScaledVector(dir, 0.004), dir);
        ray.far = dist - 0.01;
        const hits = ray.intersectObjects(others, true);
        if (!hits.length) hitFree++;
      }
    }
    return total ? hitFree / total : 1;
  }

  /* ---------------------------- final check ---------------------------- */
  function finalCheck() {
    const bad = [];
    const warn = [];
    const offenders = [];
    const blame = (dish, text) => { bad.push(text); offenders.push(dish); };
    const meshOf = new Map(dishes.map((d) => [d, d.mesh]));

    for (const dish of dishes) {
      const { key, rack, bb } = rackOf(dish);

      if (!key) {
        blame(dish, `The ${low(dish.def.name)} ended up out of the racks.`);
        continue;
      }
      if (bb.min.y < rack.cfg.y - 0.020) {
        blame(dish, `The ${low(dish.def.name)} slipped through and fouled the spray arm.`);
        continue;
      }
      if (bb.min.x < TUB.x0 - 0.002 || bb.max.x > TUB.x1 + 0.002 ||
          bb.min.z < TUB.z0 - 0.002 || bb.max.z > TUB.z1 + 0.002 ||
          bb.max.y > TUB.y1 + 0.002) {
        blame(dish, `The ${low(dish.def.name)} is pressed against the tub.`);
        continue;
      }
      if (dish.openVessel) {
        const d = openingDir(dish).y;
        if (d > -0.30) {
          blame(dish, d > 0.3
            ? `The ${low(dish.def.name)} is facing up — it filled with dirty water.`
            : `The ${low(dish.def.name)} is on its side and held a puddle.`);
          continue;
        }
      }
      const belongs = dish.def.belongs;
      if (belongs === 'upper' && key === 'lower') {
        warn.push(`The ${low(dish.def.name)} rode out the cycle in the bottom rack, in the full force of the spray.`);
      } else if (belongs === 'lower' && key === 'upper') {
        warn.push(`The ${low(dish.def.name)} is too heavy for the upper rack.`);
      }
    }

    // coverage last: it is the expensive one, and only matters if the load is legal
    let dirtiest = 1, dirtyCount = 0, filthy = 0, dirtyName = '';
    if (!bad.length) {
      for (const dish of dishes) {
        const others = dishes.filter((d) => d !== dish).map((d) => meshOf.get(d));
        const cov = coverage(dish, others);
        dish.lastCoverage = cov;
        if (cov < 0.60) {
          dirtyCount++;
          if (cov < 0.34) filthy++;
          if (cov < dirtiest) { dirtiest = cov; dirtyName = low(dish.def.name); }
        }
      }
      if (dirtyCount === 1) {
        warn.push(`The ${dirtyName} came out streaky — something was shading it from the spray.`);
      } else if (dirtyCount > 1) {
        warn.push(`${dirtyCount} items came out streaky. The load is packed too tightly to rinse through.`);
      }
    }

    let stars = 0;
    if (!bad.length) {
      stars = 3;
      if (dirtyCount > 0) stars--;
      if (filthy > 0 || dirtyCount > 3) stars--;
      if (warn.some((w) => /bottom rack|upper rack/.test(w))) stars = Math.min(stars, 2);
      stars = Math.max(1, stars);
    }

    return { pass: !bad.length, stars, bad, warn, dirtyCount, filthy, offenders };
  }

  /* ------------------------------ the run ------------------------------ */
  let running = false;
  let spray = 0;
  let sprayT = 0;
  const phase = new WeakMap();

  /**
   * `quick` compresses the pauses and speeds the mechanism up. It exists for the
   * integration test, which drives the whole cycle under software rendering where
   * game time crawls; the checks it performs are identical either way.
   */
  async function run(opts = {}) {
    if (running) return null;
    running = true;
    // Only the pauses are compressed. The mechanism keeps its real speed: racing the
    // racks in at test speed would fling the load about and prove nothing.
    const q = opts.quick ? 0.15 : 1;
    try {
      onPhase('Checking the load…');
      await sleep(0.35 * q);

      const pre = preflight();
      if (pre.length) {
        running = false;
        return {
          pass: false, stars: 0, aborted: true,
          bad: pre.slice(0, 4).map((i) => i.text),
          warn: pre.length > 4 ? [`…and ${pre.length - 4} more like it.`] : [],
          // the dishes to blame, so the game can point at them instead of starting over
          offenders: [...new Set(pre.map((i) => i.dish))],
        };
      }

      onPhase('Rolling the racks in…');
      dw.racks.lower.slideIn();
      dw.racks.upper.slideIn();
      await until(() => !dw.racks.lower.isMoving && !dw.racks.upper.isMoving, 4);
      await sleep(0.45 * q);

      onPhase('Closing the door…');
      dw.door.close();
      await until(() => dw.door.isClosed && !dw.door.isMoving, 3);
      await sleep(0.35 * q);

      onPhase('Washing…');
      spray = 1;
      sprayT = 0;
      await sleep(2.6 * q);
      spray = 0;
      await sleep(0.7 * q);

      onPhase('Draining…');
      await sleep(0.5 * q);

      onPhase('Checking the results…');
      const res = finalCheck();
      await sleep(0.3 * q);
      running = false;
      return res;
    } catch (err) {
      running = false;
      throw err;
    }
  }

  /**
   * While the cycle runs, the spray really does push on the load — a stack that was
   * only balanced falls over here, which is exactly the outcome the player earned.
   */
  function applySpray(dt = 1 / 60) {
    if (!spray) return;
    sprayT += dt;
    for (const dish of dishes) {
      const b = dish.body;
      if (b.mass <= 0) continue;
      const arm = armFor(b.position.y);
      const dy = b.position.y - arm.y;
      if (dy < 0.01 || dy > 0.42) continue;

      /* A fraction of the item's own weight, falling off with distance from the arm,
         swept round as the arm turns. Expressed in weights rather than newtons per
         frame so the buffeting is the same at 144 fps and at 15, and swept rather
         than white noise so it rocks a marginal stack instead of random-walking a
         well-placed one across the rack. */
      if (!phase.has(b)) phase.set(b, Math.random() * Math.PI * 2);
      const ph = phase.get(b);
      const near = Math.min(2.2, 0.5 / (0.12 + dy));
      const w = b.mass * 9.82;
      const lateral = w * 0.045 * near;
      const force = new CANNON.Vec3(
        Math.sin(sprayT * 5.4 + ph) * lateral,
        w * 0.045 * near * (0.6 + 0.4 * Math.sin(sprayT * 7.1 + ph)),
        Math.cos(sprayT * 4.1 + ph * 1.7) * lateral,
      );
      /* The second argument is an offset from the centre of mass, not a world point.
         Passing the body's absolute position gave every jet a half-metre lever arm and
         spun the dishes like tops — a carefully packed rack came apart in the wash for
         no reason the player could see. A centimetre or two off centre is what a jet
         glancing off a curved surface actually does. */
      const nudge = new CANNON.Vec3(
        Math.cos(sprayT * 3.3 + ph) * 0.012, 0, Math.sin(sprayT * 2.7 + ph) * 0.012,
      );
      b.applyForce(force, nudge);
      b.wakeUp();
    }
  }

  return {
    run, tick, applySpray, preflight, rackOf, openingDir,
    /** Spray coverage for one dish, 0..1. Exposed so the rule can be tested on its own. */
    coverageOf(dish) {
      return coverage(dish, dishes.filter((d) => d !== dish).map((d) => d.mesh));
    },
    get running() { return running; },
  };
}

/** "Dinner plate" -> "dinner plate", but leave real names alone. */
function low(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
