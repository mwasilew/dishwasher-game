/**
 * Renderer, camera, lighting and the little kitchen the dishwasher sits in.
 *
 * There are no image assets anywhere in this project, so the environment map for
 * the stainless steel is generated at runtime: a small equirectangular gradient
 * with a bright "window" band, run through PMREM. It costs nothing and it is the
 * difference between steel that looks like metal and steel that looks like grey paint.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0d11);
  scene.fog = new THREE.Fog(0x0a0d11, 2.6, 7);

  const camera = new THREE.PerspectiveCamera(41, 1, 0.05, 60);
  camera.position.set(0.07, 1.58, 1.30);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.32, 0.18);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.55;
  controls.maxDistance = 3.4;
  controls.maxPolarAngle = 1.26;   // stay above the horizon: the carry plane needs an angle to hit
  controls.minPolarAngle = Math.PI * 0.06;
  // Left mouse belongs to the dishes, not the camera.
  // LEFT is switched between orbit and "leave it to the dishes" by the grabber
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.update();

  scene.environment = buildEnvironment(renderer);
  addLights(scene);
  addKitchen(scene);

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  addEventListener('resize', resize);
  resize();

  return { renderer, scene, camera, controls, resize };
}

/* --------------------------- procedural IBL --------------------------- */
function buildEnvironment(renderer) {
  const W = 64, H = 32;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);                       // 0 = up, 1 = down
    // soft daylight from above, warm bounce from the floor
    let r = THREE.MathUtils.lerp(150, 40, t);
    let g = THREE.MathUtils.lerp(168, 36, t);
    let b = THREE.MathUtils.lerp(196, 34, t);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // a bright window panel, so the steel gets a highlight to catch
      const win = Math.exp(-(((u - 0.22) ** 2) / 0.008 + ((t - 0.34) ** 2) / 0.012)) * 220;
      const i = (y * W + x) * 4;
      data[i] = Math.min(255, r + win);
      data[i + 1] = Math.min(255, g + win);
      data[i + 2] = Math.min(255, b + win * 1.05);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/* ------------------------------- lights ------------------------------- */
function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xb9d4ee, 0x2a2620, 0.7));

  const key = new THREE.DirectionalLight(0xfff4e2, 1.7);
  key.position.set(1.6, 2.6, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 7;
  const s = 1.5;
  Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.012;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x9fc2e8, 0.5);
  fill.position.set(-2.0, 1.4, 1.1);
  scene.add(fill);

  // Interior light so the inside of the tub is readable when the door is down.
  const tubLight = new THREE.PointLight(0xdff0ff, 1.0, 1.5, 2);
  tubLight.position.set(0, 0.62, 0.30);
  scene.add(tubLight);

  const rim = new THREE.PointLight(0xffd9a8, 0.7, 3, 2);
  rim.position.set(0.9, 0.35, 1.1);
  scene.add(rim);
}

/* ------------------------------- kitchen ------------------------------- */
function addKitchen(scene) {
  const g = new THREE.Group();
  g.name = 'kitchen';

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.72, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.001;
  floor.receiveShadow = true;
  g.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2e343c, roughness: 0.94 });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), wallMat);
  back.position.set(0, 1.6, -0.32);
  back.receiveShadow = true;
  g.add(back);

  /* Counter runs either side of the machine but stops short of it: this is the
     freestanding version of the appliance, with its own worktop. A slab of granite
     cantilevered over the open door would sit right in the player's sightline. */
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.34, metalness: 0.12 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.6 });
  for (const x of [-1.12, 1.12]) {
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.62), counterMat);
    counter.position.set(x, 0.877, -0.02);
    counter.castShadow = true; counter.receiveShadow = true;
    g.add(counter);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.855, 0.58), cabMat);
    cab.position.set(x, 0.4275, -0.03);
    cab.castShadow = true; cab.receiveShadow = true;
    g.add(cab);
  }

  const splash = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 0.02), new THREE.MeshStandardMaterial({
    color: 0x333a42, roughness: 0.25, metalness: 0.1,
  }));
  splash.position.set(0, 1.15, -0.33);
  g.add(splash);

  scene.add(g);
  return g;
}
