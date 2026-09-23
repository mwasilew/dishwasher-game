/**
 * Physics layer: a thin, opinionated wrapper over cannon-es.
 *
 * The only interesting parts are the shape builders. Dishes are mostly *hollow* —
 * a mug you can drop a teaspoon into, a pot that will happily swallow a ladle — and
 * cannon has no hollow primitive, so we fake them with a ring of thin boxes plus a
 * base disc. Everything else is boxes and cylinders.
 */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export const MAT = {
  dish: new CANNON.Material('dish'),
  rack: new CANNON.Material('rack'),
  tub:  new CANNON.Material('tub'),
};

export function createWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

  world.broadphase = new CANNON.SAPBroadphase(world);
  // Sweep along Y: the load is stratified into two decks 30 cm apart, so height
  // separates bodies better than depth does. Measurably cheaper on a full machine.
  world.broadphase.axisIndex = 1;
  world.allowSleep = true;
  /* 12 iterations is the knee of the curve here: below it a stack of plates visibly
     sinks into the rack, above it we are paying for accuracy nobody can see. A full
     Christmas load is 40-odd compound bodies and has to step in a couple of
     milliseconds. */
  world.solver.iterations = 12;
  world.solver.tolerance = 0.002;
  world.defaultContactMaterial.contactEquationStiffness = 1e7;
  world.defaultContactMaterial.contactEquationRelaxation = 4;

  // Crockery on crockery: slippery, and it *rings* rather than bounces.
  world.addContactMaterial(new CANNON.ContactMaterial(MAT.dish, MAT.dish, {
    friction: 0.22, restitution: 0.02,
  }));
  // Crockery in a wire rack: grippy, so a moving rack carries its load with it.
  world.addContactMaterial(new CANNON.ContactMaterial(MAT.dish, MAT.rack, {
    friction: 0.85, restitution: 0.0,
    contactEquationStiffness: 1e8, contactEquationRelaxation: 3,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(MAT.dish, MAT.tub, {
    friction: 0.4, restitution: 0.02,
  }));

  return world;
}

/* ------------------------------------------------------------------ *
 *  Shape builders — each returns a list of { shape, offset, quat }
 *  parts, ready to be added to a compound body.
 * ------------------------------------------------------------------ */

export function partBox(w, h, d, offset = [0, 0, 0], euler = null) {
  return {
    shape: new CANNON.Box(new CANNON.Vec3(Math.max(w, 0.004) / 2, Math.max(h, 0.004) / 2, Math.max(d, 0.004) / 2)),
    offset: new CANNON.Vec3(...offset),
    quat: eulerQuat(euler),
  };
}

export function partCylinder(rTop, rBottom, h, offset = [0, 0, 0], euler = null, seg = 12) {
  return {
    shape: new CANNON.Cylinder(Math.max(rTop, 0.002), Math.max(rBottom, 0.002), Math.max(h, 0.005), seg),
    offset: new CANNON.Vec3(...offset),
    quat: eulerQuat(euler),
  };
}

export function partSphere(r, offset = [0, 0, 0]) {
  return { shape: new CANNON.Sphere(r), offset: new CANNON.Vec3(...offset), quat: eulerQuat(null) };
}

function eulerQuat(euler) {
  const q = new CANNON.Quaternion();
  if (euler) q.setFromEuler(euler[0] || 0, euler[1] || 0, euler[2] || 0, 'XYZ');
  return q;
}

/**
 * A hollow, open-topped vessel: mug, glass, bowl, stockpot, wok.
 *
 * `segments` thin boxes form the wall, tilted to follow the taper, plus a disc for
 * the base. Opening faces local +Y, which is also what the "does it hold water?"
 * check assumes.
 */
export function partsVessel({
  rBottom, rTop, height, segments = 10, wall = 0.006, base = 0.008, yBase = 0,
}) {
  const parts = [];
  parts.push(partCylinder(rBottom, rBottom, base, [0, yBase + base / 2, 0]));

  const rMid = (rBottom + rTop) / 2;
  const wallH = height - base;
  const tilt = Math.atan2(rTop - rBottom, wallH);   // lean of the wall from vertical
  const segW = (2 * Math.PI * rMid) / segments * 1.12;  // 12% overlap so there are no gaps
  const yMid = yBase + base + wallH / 2;

  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.sin(a) * rMid;
    const z = Math.cos(a) * rMid;
    const p = partBox(segW, wallH / Math.cos(tilt), wall, [x, yMid, z]);
    // orient the panel: face outward, then lean it out by the taper angle
    const q = new CANNON.Quaternion().setFromEuler(0, a, 0, 'XYZ');
    const lean = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -tilt);
    q.mult(lean, q);
    p.quat = q;
    parts.push(p);
  }
  return parts;
}

/** A hollow rectangular tub: casserole dish, tupperware, cutlery basket. */
export function partsOpenBox({ w, d, height, wall = 0.008, base = 0.008, yBase = 0 }) {
  const wallH = height - base;
  const yMid = yBase + base + wallH / 2;
  return [
    partBox(w, base, d, [0, yBase + base / 2, 0]),
    partBox(w, wallH, wall, [0, yMid, d / 2 - wall / 2]),
    partBox(w, wallH, wall, [0, yMid, -d / 2 + wall / 2]),
    partBox(wall, wallH, d - wall * 2, [w / 2 - wall / 2, yMid, 0]),
    partBox(wall, wallH, d - wall * 2, [-w / 2 + wall / 2, yMid, 0]),
  ];
}

/** Assemble a body from parts. */
export function makeBody({ parts, mass = 0, material = MAT.dish, type, position, linearDamping = 0.12, angularDamping = 0.22 }) {
  const bodyType = type ?? (mass > 0 ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC);
  const body = new CANNON.Body({
    mass,
    material,
    type: bodyType,
    linearDamping,
    angularDamping,
    /* Only dishes may sleep. Cannon's integrator skips a sleeping body outright, so a
       kinematic one that dozed off — a rack, the door — would silently refuse to move
       however much velocity you gave it, and would stop pushing anything resting on
       it. Sleeping is a saving on the forty dynamic bodies; the machine is a dozen. */
    allowSleep: bodyType === CANNON.Body.DYNAMIC,
    sleepSpeedLimit: 0.09,
    sleepTimeLimit: 0.3,
  });
  for (const p of parts) body.addShape(p.shape, p.offset, p.quat);
  if (position) body.position.set(position[0], position[1], position[2]);
  return body;
}

/* ------------------------------------------------------------------ *
 *  Mesh <-> body sync
 * ------------------------------------------------------------------ */

export function syncMeshToBody(mesh, body) {
  mesh.position.set(body.position.x, body.position.y, body.position.z);
  mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
}

export const v3 = (v) => new THREE.Vector3(v.x, v.y, v.z);
export const cv = (v) => new CANNON.Vec3(v.x, v.y, v.z);

/** World-space AABB of a body, as a THREE.Box3. */
export function bodyAABB(body) {
  body.updateAABB();
  return new THREE.Box3(
    new THREE.Vector3(body.aabb.lowerBound.x, body.aabb.lowerBound.y, body.aabb.lowerBound.z),
    new THREE.Vector3(body.aabb.upperBound.x, body.aabb.upperBound.y, body.aabb.upperBound.z),
  );
}

/** Is the body still moving in any meaningful way? */
export function isSettled(body, lin = 0.035, ang = 0.25) {
  return body.sleepState === CANNON.Body.SLEEPING ||
    (body.velocity.lengthSquared() < lin * lin && body.angularVelocity.lengthSquared() < ang * ang);
}

export { CANNON };
