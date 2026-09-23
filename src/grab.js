/**
 * Picking up, carrying, turning and dropping dishes.
 *
 * The carried dish is held by a point-to-point constraint to an invisible joint body
 * that tracks the cursor, so it stays a real rigid body the whole time: it bumps into
 * the rack, wedges against its neighbours, and refuses to go where it doesn't fit.
 * Orientation, by contrast, is driven directly — a spring you have to fight while
 * aiming a pan handle is not fun.
 */
import * as THREE from 'three';
import { CANNON } from './physics.js';

const CARRY_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.48, 0.16, -0.32),
  new THREE.Vector3(0.48, 1.25, 1.00),
);

export function createGrabber({ camera, canvas, world, scene, controls, getDishes, onPickup, onDrop, onHoverChange }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(0, 0);
  const pointer = { x: 0, y: 0, inside: false };

  /* The carried dish tracks a horizontal plane at its carry height, not a plane
     parallel to the screen. Looking down into a drawer, the mouse then maps straight
     onto the rack floor — you aim at the gap you want, and the wheel is simply "lift"
     — which is far easier to judge than pushing an object along the view axis. */
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  // scratch objects: update() runs every frame and should not allocate
  const _target = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();

  const jointBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  jointBody.addShape(new CANNON.Sphere(0.002));
  jointBody.collisionFilterGroup = 0;
  jointBody.collisionFilterMask = 0;
  world.addBody(jointBody);

  let held = null;              // { dish, constraint, depth, targetQuat, savedDamping }
  let hovered = null;
  // hover picking is a raycast against every dish: only redo it when the cursor moves
  let pointerMoved = false;

  // drop indicator: a ring on the deck straight below whatever you are carrying
  const ringGeo = new THREE.RingGeometry(0.028, 0.036, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0x3fb6ff, transparent: true, opacity: 0.75, depthTest: false,
  }));
  ring.renderOrder = 5;
  ring.visible = false;
  scene.add(ring);

  const guideMat = new THREE.LineBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.35, depthTest: false });
  const guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), guideMat);
  guide.renderOrder = 5;
  guide.visible = false;
  scene.add(guide);

  /* ------------------------------ pointer ------------------------------ */
  function updateNDC(e) {
    const r = canvas.getBoundingClientRect();
    if (e.clientX !== pointer.x || e.clientY !== pointer.y) pointerMoved = true;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function pickDish() {
    ray.setFromCamera(ndc, camera);
    const dishes = getDishes();
    const meshes = dishes.map((d) => d.mesh);
    const hits = ray.intersectObjects(meshes, true);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && !o.userData.dishRef) o = o.parent;
    return o ? o.userData.dishRef : null;
  }

  /* ------------------------------- grab -------------------------------- */
  function grab(dish, opts = {}) {
    if (held) release();
    const b = dish.body;
    b.wakeUp();
    b.type = CANNON.Body.DYNAMIC;
    b.updateMassProperties();

    const depth = Math.max(0.35, camera.position.distanceTo(
      new THREE.Vector3(b.position.x, b.position.y, b.position.z)));
    const carryY = opts.carryY ?? Math.max(b.position.y, (opts.deckY ?? 0.196) + 0.14);

    const c = new CANNON.PointToPointConstraint(
      b, new CANNON.Vec3(0, 0, 0), jointBody, new CANNON.Vec3(0, 0, 0),
      Math.max(40, b.mass * 260),
    );
    world.addConstraint(c);

    held = {
      dish,
      constraint: c,
      depth,
      carryY,
      deckY: opts.deckY ?? 0.196,
      targetQuat: new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w),
      savedDamping: [b.linearDamping, b.angularDamping],
    };
    b.linearDamping = 0.55;
    b.angularDamping = 0.9;
    b.allowSleep = false;

    jointBody.position.copy(b.position);
    ring.visible = true;
    guide.visible = true;
    setHover(null);
    updateLeftButton();
    onPickup?.(dish);
    return true;
  }

  function release() {
    if (!held) return null;
    const { dish, constraint, savedDamping } = held;
    world.removeConstraint(constraint);
    const b = dish.body;
    b.linearDamping = savedDamping[0];
    b.angularDamping = savedDamping[1];
    b.allowSleep = true;
    // shed the carry velocity so nothing is flung across the kitchen
    b.velocity.scale(0.15, b.velocity);
    b.angularVelocity.scale(0.2, b.angularVelocity);
    held = null;
    ring.visible = false;
    guide.visible = false;
    updateLeftButton();
    onDrop?.(dish);
    return dish;
  }

  /* ------------------------------ rotation ------------------------------ */
  function camAxis(which) {
    const m = camera.matrixWorld;
    const v = new THREE.Vector3().setFromMatrixColumn(m, which === 'right' ? 0 : 1);
    if (which === 'right') v.y = 0;
    return v.normalize();
  }

  function turn(axis, angleDeg) {
    if (!held) return;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg));
    held.targetQuat.premultiply(q);
  }

  const rotate = {
    yaw: (deg) => turn(new THREE.Vector3(0, 1, 0), deg),
    tip: (deg) => turn(camAxis('right'), deg),
    flip: () => turn(camAxis('right'), 180),
    faceDown: () => {
      if (!held) return;
      // point the item's local +Y (the opening) straight down, keeping its heading
      const yaw = new THREE.Euler().setFromQuaternion(held.targetQuat, 'YXZ').y;
      held.targetQuat.setFromEuler(new THREE.Euler(Math.PI, yaw, 0, 'YXZ'));
    },
  };

  /* ------------------------------- update ------------------------------- */
  /** Where the carried dish should be right now, from the cursor. */
  function carryTarget() {
    ray.setFromCamera(ndc, camera);
    dragPlane.constant = -held.carryY;
    const facing = Math.abs(ray.ray.direction.y);
    if (facing > 0.12 && ray.ray.intersectPlane(dragPlane, hitPoint)) _target.copy(hitPoint);
    // camera almost level with the plane: fall back to a fixed distance along the ray
    else _target.copy(ray.ray.origin).addScaledVector(ray.ray.direction, held.depth);
    return CARRY_BOUNDS.clampPoint(_target, _target);
  }

  function update(dt) {
    if (held) {
      const target = carryTarget();
      jointBody.position.set(target.x, target.y, target.z);

      const b = held.dish.body;
      // orientation is driven, not simulated
      _quat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      _quat.slerp(held.targetQuat, Math.min(1, dt * 14));
      b.quaternion.set(_quat.x, _quat.y, _quat.z, _quat.w);
      b.angularVelocity.set(0, 0, 0);
      b.wakeUp();

      // where it will land, and how far it has to fall to get there
      _pos.set(b.position.x, b.position.y, b.position.z);
      const floor = held.deckY + 0.004;
      ring.position.set(_pos.x, floor, _pos.z);
      ring.scale.setScalar(Math.max(0.6, 0.6 + held.dish.radius * 6));
      const line = guide.geometry.attributes.position;
      line.setXYZ(0, _pos.x, _pos.y, _pos.z);
      line.setXYZ(1, _pos.x, floor, _pos.z);
      line.needsUpdate = true;
    } else if (pointer.inside && pointerMoved) {
      pointerMoved = false;
      setHover(pickDish());
    }
  }

  function setHover(dish) {
    if (hovered === dish) return;
    hovered = dish;
    onHoverChange?.(dish);
    canvas.style.cursor = dish ? 'grab' : 'default';
    updateLeftButton();
  }

  /**
   * Left-drag orbits the camera over empty space but picks up a dish when the cursor
   * is over one — decided on hover, because OrbitControls' own pointerdown listener
   * was registered first and would otherwise always win.
   */
  function updateLeftButton() {
    if (!controls) return;
    controls.mouseButtons.LEFT = (hovered || held) ? null : THREE.MOUSE.ROTATE;
    controls.touches.ONE = (hovered || held) ? null : THREE.TOUCH.ROTATE;
  }

  /* ------------------------------- events ------------------------------- */
  function onPointerMove(e) { updateNDC(e); }
  function onPointerLeave() { pointer.inside = false; setHover(null); }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    updateNDC(e);
    if (held) { release(); return; }
    const d = pickDish();
    if (d && !d.locked) grab(d);
  }

  function onWheel(e) {
    if (!held) return;                     // otherwise it's a camera zoom
    e.preventDefault();
    e.stopPropagation();
    held.carryY = THREE.MathUtils.clamp(
      held.carryY - Math.sign(e.deltaY) * 0.022, held.deckY + 0.015, 1.05);
    held.depth = THREE.MathUtils.clamp(held.depth + Math.sign(e.deltaY) * 0.03, 0.25, 3.0);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });

  return {
    get held() { return held?.dish ?? null; },
    get hovered() { return hovered; },
    grab, release, rotate, update,
    setDeckY(y) {
      if (!held) return;
      held.deckY = y;
      held.carryY = Math.max(held.carryY, y + 0.10);
    },
    setDepthFromPoint(p) {
      if (held) held.depth = camera.position.distanceTo(p);
    },
    dispose() {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('wheel', onWheel, { capture: true });
    },
  };
}
