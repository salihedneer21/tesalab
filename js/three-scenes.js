/* ════════════════════════════════════════════
   TesaLab — WebGL signal visualizations
   Palette: cobalt field · porcelain white · ECG-trace green
   Every scene reads as telemetry from a working
   system, not decoration.
   ════════════════════════════════════════════ */
import * as THREE from "three";

const COBALT = 0x4a7fc1;        // brand cobalt, brightened for dark fields
const COBALT_DIM = 0x2c5587;
const PORCELAIN = 0xe9eff8;
const TRACE = 0x4fe3a3;         // ECG green — live signal only
const FIELD = 0x16304f;         // matches --field

const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clock = new THREE.Clock();
const scenes = [];

function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return renderer;
}

function fitRenderer(entry) {
  const { renderer, camera, canvas } = entry;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function registerScene(entry) {
  scenes.push(entry);
  fitRenderer(entry);
  const io = new IntersectionObserver(([e]) => { entry.visible = e.isIntersecting; }, { rootMargin: "120px" });
  io.observe(entry.canvas);
}

function standardMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.35, metalness: 0.35,
    emissive: color, emissiveIntensity: 0.12, ...opts,
  });
}

function addLights(scene, accent = COBALT) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.PointLight(0xffffff, 220, 120);
  key.position.set(12, 10, 14);
  scene.add(key);
  const rim = new THREE.PointLight(accent, 160, 120);
  rim.position.set(-12, -6, 10);
  scene.add(rim);
}

/* ════════════════════════════════════════════
   HERO — DNA double helix with a live signal
   pulse travelling up one backbone
   ════════════════════════════════════════════ */
function buildHero() {
  const canvas = document.getElementById("heroCanvas");
  if (!canvas) return;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FIELD, 0.026);
  const camera = new THREE.PerspectiveCamera(55, 2, 0.1, 200);
  camera.position.set(0, 0, 26);

  const renderer = makeRenderer(canvas);
  addLights(scene, COBALT);

  const helix = new THREE.Group();
  const rungs = 32, radius = 4.0, height = 30, twist = Math.PI * 4.2;

  const sphereGeo = new THREE.SphereGeometry(0.38, 20, 20);
  const matWhite = standardMat(PORCELAIN, { emissiveIntensity: 0.05 });
  const matCobalt = standardMat(COBALT);
  const rungMat = standardMat(COBALT_DIM, { transparent: true, opacity: 0.6, emissiveIntensity: 0.05 });

  for (let i = 0; i < rungs; i++) {
    const t = i / (rungs - 1);
    const angle = t * twist;
    const y = (t - 0.5) * height;
    const a = new THREE.Mesh(sphereGeo, matWhite);
    a.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    const b = new THREE.Mesh(sphereGeo, matCobalt);
    b.position.set(Math.cos(angle + Math.PI) * radius, y, Math.sin(angle + Math.PI) * radius);
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, radius * 2, 8), rungMat);
    rung.position.set(0, y, 0);
    rung.lookAt(a.position);
    rung.rotateX(Math.PI / 2);
    helix.add(a, b, rung);
  }

  // backbone tubes + the curve the pulse rides
  let pulseCurve = null;
  for (const phase of [0, Math.PI]) {
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const angle = t * twist + phase;
      pts.push(new THREE.Vector3(Math.cos(angle) * radius, (t - 0.5) * height, Math.sin(angle) * radius));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    if (phase === 0) pulseCurve = curve;
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 160, 0.11, 8),
      standardMat(phase === 0 ? PORCELAIN : COBALT, { transparent: true, opacity: 0.9, emissiveIntensity: 0.06 })
    );
    helix.add(tube);
  }

  // live signal — a green pulse travelling the backbone
  const pulse = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 18, 18),
    new THREE.MeshStandardMaterial({ color: TRACE, emissive: TRACE, emissiveIntensity: 1.4, roughness: 0.2 })
  );
  const pulseLight = new THREE.PointLight(TRACE, 90, 16);
  pulse.add(pulseLight);
  helix.add(pulse);

  helix.rotation.z = 0.42;
  helix.position.set(10, 0, -3);
  scene.add(helix);

  // sparse measurement field — quiet white points
  const pCount = 420;
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 55;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50 - 8;
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({ color: PORCELAIN, size: 0.1, transparent: true, opacity: 0.45 })
  );
  scene.add(particles);

  let mx = 0, my = 0;
  window.addEventListener("pointermove", (e) => {
    mx = (e.clientX / window.innerWidth - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  registerScene({
    renderer, scene, camera, canvas, visible: true,
    update(t) {
      helix.rotation.y = t * 0.22;
      particles.rotation.y = t * 0.015;
      const p = pulseCurve.getPointAt((t * 0.12) % 1);
      pulse.position.copy(p);
      if (!prefersReduced) {
        camera.position.x += (mx * 1.8 - camera.position.x) * 0.04;
        camera.position.y += (-my * 1.2 - camera.position.y) * 0.04;
      }
      camera.lookAt(3, 0, 0);
    },
  });
}

/* ════════════════════════════════════════════
   PLATFORM — node network with a heartbeat core
   ════════════════════════════════════════════ */
function buildMolecule() {
  const canvas = document.getElementById("moleculeCanvas");
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 0, 15);

  const renderer = makeRenderer(canvas);
  addLights(scene, COBALT);

  const group = new THREE.Group();
  scene.add(group);

  const nodeCount = 42, R = 5;
  const nodes = [];
  const nodeGeo = new THREE.SphereGeometry(0.26, 16, 16);
  const matWhite = standardMat(PORCELAIN, { emissiveIntensity: 0.05 });
  const matCobalt = standardMat(COBALT);
  for (let i = 0; i < nodeCount; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / nodeCount);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const p = new THREE.Vector3(
      R * Math.cos(theta) * Math.sin(phi),
      R * Math.sin(theta) * Math.sin(phi),
      R * Math.cos(phi)
    );
    const mesh = new THREE.Mesh(nodeGeo, i % 3 ? matCobalt : matWhite);
    mesh.position.copy(p);
    mesh.userData.base = p.clone();
    mesh.userData.seed = Math.random() * 10;
    group.add(mesh);
    nodes.push(mesh);
  }

  const lineMat = new THREE.LineBasicMaterial({ color: COBALT_DIM, transparent: true, opacity: 0.5 });
  const linePairs = [];
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      if (nodes[i].userData.base.distanceTo(nodes[j].userData.base) < 2.6) {
        const geo = new THREE.BufferGeometry().setFromPoints([nodes[i].position, nodes[j].position]);
        const line = new THREE.Line(geo, lineMat);
        group.add(line);
        linePairs.push({ line, a: nodes[i], b: nodes[j] });
      }
    }
  }

  // heartbeat core — the live center of the platform
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.9, 1),
    new THREE.MeshStandardMaterial({ color: COBALT, wireframe: true, transparent: true, opacity: 0.5 })
  );
  const heart = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 24, 24),
    new THREE.MeshStandardMaterial({ color: TRACE, emissive: TRACE, emissiveIntensity: 0.9, roughness: 0.2 })
  );
  group.add(core, heart);

  registerScene({
    renderer, scene, camera, canvas, visible: true,
    update(t) {
      group.rotation.y = t * 0.18;
      group.rotation.x = Math.sin(t * 0.25) * 0.1;
      for (const n of nodes) {
        const s = 1 + Math.sin(t * 1.2 + n.userData.seed) * 0.05;
        n.position.copy(n.userData.base).multiplyScalar(s);
      }
      for (const lp of linePairs) {
        const a = lp.line.geometry.attributes.position;
        a.setXYZ(0, lp.a.position.x, lp.a.position.y, lp.a.position.z);
        a.setXYZ(1, lp.b.position.x, lp.b.position.y, lp.b.position.z);
        a.needsUpdate = true;
      }
      const beat = 1 + Math.max(0, Math.sin(t * 2.2)) ** 6 * 0.16;
      heart.scale.setScalar(beat);
      core.rotation.y = -t * 0.3;
    },
  });
}

/* ════════════════════════════════════════════
   CASE PANELS — one instrument per product
   ════════════════════════════════════════════ */
function buildCasePanel(canvas) {
  const type = canvas.dataset.scene;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 2, 0.1, 60);
  camera.position.set(0, 0, 9);

  const renderer = makeRenderer(canvas);
  addLights(scene, COBALT);

  const matWhite = standardMat(PORCELAIN, { emissiveIntensity: 0.05 });
  const matCobalt = standardMat(COBALT);
  const matTrace = new THREE.MeshStandardMaterial({ color: TRACE, emissive: TRACE, emissiveIntensity: 1.1, roughness: 0.2 });
  const wireCobalt = new THREE.MeshBasicMaterial({ color: COBALT, wireframe: true, transparent: true, opacity: 0.4 });

  const group = new THREE.Group();
  scene.add(group);
  let update = (t) => { group.rotation.y = t * 0.4; };

  if (type === "spine") {
    // articulated joint chain — motion capture
    const joints = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.4 - Math.abs(i - 4) * 0.02, 16, 16), i === 4 ? matTrace : matWhite);
      s.userData.i = i;
      group.add(s);
      joints.push(s);
    }
    const links = [];
    for (let i = 1; i < 9; i++) {
      const link = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8), matCobalt);
      group.add(link);
      links.push(link);
    }
    update = (t) => {
      group.rotation.y = Math.sin(t * 0.4) * 0.6;
      joints.forEach((j) => {
        const i = j.userData.i;
        j.position.set(Math.sin(i * 0.7 + t * 0.9) * 0.8, (i - 4) * 0.78, Math.cos(i * 0.5 + t * 0.7) * 0.3);
      });
      links.forEach((link, k) => {
        const a = joints[k].position, b = joints[k + 1].position;
        link.position.copy(a).lerp(b, 0.5);
        link.scale.y = a.distanceTo(b);
        link.lookAt(b.clone().add(group.position));
        link.rotateX(Math.PI / 2);
      });
    };
  } else if (type === "blocks") {
    // ordered code blocks moving through a pipeline
    const blocks = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.1), i === 2 ? matTrace : i % 2 ? matCobalt : matWhite);
      b.userData.i = i;
      group.add(b);
      blocks.push(b);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.06, 0.06), matCobalt);
    rail.position.y = -1.1;
    group.add(rail);
    update = (t) => {
      group.rotation.y = 0.5;
      group.rotation.x = 0.25;
      blocks.forEach((b) => {
        const x = ((b.userData.i * 1.6 + t * 1.1) % 9.6) - 4.8;
        b.position.set(x, Math.sin(x * 0.8) * 0.18, 0);
        b.rotation.y = x * 0.2;
      });
    };
  } else if (type === "globe") {
    // enrollment globe with orbiting site beacons
    const globe = new THREE.Mesh(new THREE.SphereGeometry(2.1, 28, 20), wireCobalt);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 24), matCobalt);
    group.add(globe, inner);
    const sats = [];
    for (let i = 0; i < 4; i++) {
      const sat = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), i === 0 ? matTrace : matWhite);
      sat.userData.o = { r: 2.9 + i * 0.35, speed: 0.7 + i * 0.25, phase: i * 1.7 };
      group.add(sat);
      sats.push(sat);
    }
    update = (t) => {
      group.rotation.y = t * 0.3;
      sats.forEach((s) => {
        const o = s.userData.o;
        s.position.set(
          Math.cos(t * o.speed + o.phase) * o.r,
          Math.sin(t * o.speed * 0.6 + o.phase) * 0.9,
          Math.sin(t * o.speed + o.phase) * o.r
        );
      });
    };
  } else {
    // conduit — records flowing between two systems
    const endA = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), matWhite);
    endA.position.x = -3.4;
    const endB = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), matCobalt);
    endB.position.x = 3.4;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-3.4, 0, 0),
      new THREE.Vector3(-1.2, 0.9, 0.4),
      new THREE.Vector3(1.2, -0.9, -0.4),
      new THREE.Vector3(3.4, 0, 0),
    ]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.08, 8), standardMat(COBALT_DIM, { transparent: true, opacity: 0.8 }));
    group.add(endA, endB, tube);
    const packets = [];
    for (let i = 0; i < 5; i++) {
      const pk = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), matTrace);
      pk.userData.offset = i / 5;
      group.add(pk);
      packets.push(pk);
    }
    update = (t) => {
      group.rotation.y = Math.sin(t * 0.3) * 0.35;
      group.rotation.x = Math.sin(t * 0.2) * 0.15;
      endA.rotation.y = t * 0.4;
      endB.rotation.y = -t * 0.4;
      packets.forEach((pk) => {
        pk.position.copy(curve.getPointAt((t * 0.14 + pk.userData.offset) % 1));
      });
    };
  }

  registerScene({ renderer, scene, camera, canvas, visible: true, update });
}

/* ════════════════════════════════════════════
   CTA — ECG sweep across a measurement grid
   ════════════════════════════════════════════ */
function buildCtaWave() {
  const canvas = document.getElementById("ctaCanvas");
  if (!canvas) return;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FIELD, 0.04);
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.position.set(0, 6, 16);
  camera.lookAt(0, 0, 0);

  const renderer = makeRenderer(canvas);

  const cols = 70, rows = 36, gap = 0.85;
  const count = cols * rows;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cBase = new THREE.Color(COBALT_DIM);
  let k = 0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      positions[k * 3] = (i - cols / 2) * gap;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = (j - rows / 2) * gap;
      colors[k * 3] = cBase.r; colors[k * 3 + 1] = cBase.g; colors[k * 3 + 2] = cBase.b;
      k++;
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.95 }));
  points.position.y = -2.5;
  scene.add(points);

  const cTrace = new THREE.Color(TRACE);
  const cWhite = new THREE.Color(PORCELAIN);

  registerScene({
    renderer, scene, camera, canvas, visible: true,
    update(t) {
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      const sweepX = ((t * 9) % (cols * gap * 1.4)) - (cols / 2) * gap * 1.2;
      let k = 0;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = (i - cols / 2) * gap;
          const dx = Math.abs(x - sweepX);
          // ECG sweep: a sharp green spike travelling left→right over a calm field
          const spike = Math.max(0, 1 - dx * 0.45);
          pos.setY(k, Math.sin(x * 0.35 + t * 0.7) * 0.25 + spike * spike * 2.4);
          const c = cBase.clone().lerp(spike > 0.45 ? cTrace : cWhite, spike * 0.9);
          col.setXYZ(k, c.r, c.g, c.b);
          k++;
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    },
  });
}

/* ── boot ─────────────────────────────────── */
buildHero();
buildMolecule();
document.querySelectorAll(".case__panel canvas[data-scene]").forEach(buildCasePanel);
buildCtaWave();

window.addEventListener("resize", () => scenes.forEach(fitRenderer));

let renderedOnce = false;
function loop() {
  requestAnimationFrame(loop);
  const t = prefersReduced ? 4 : clock.getElapsedTime();
  if (prefersReduced && renderedOnce) return; // single calm frame
  for (const s of scenes) {
    if (!s.visible && renderedOnce) continue;
    s.update(t);
    s.renderer.render(s.scene, s.camera);
  }
  renderedOnce = true;
}
loop();
