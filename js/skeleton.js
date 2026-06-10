/* ════════════════════════════════════════════
   TesaLab — interactive 3D skeleton viewer
   Model: Open3DModel / Z-Anatomy overview skeleton
   (BodyParts3D), CC BY-SA 4.0. Right hemi-skeleton
   mirrored at load to a full body; limbs are
   reparented into a joint hierarchy so they pose.
   ════════════════════════════════════════════ */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const TRACE = 0x4fe3a3;
const BONE = 0xe9e1cf;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const stage = document.getElementById("stage");
const loadingEl = document.getElementById("loading");
const idName = document.getElementById("id-name");
const idSub = document.getElementById("id-sub");

/* ── renderer / scene / camera ─────────────── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1c30);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(0, 1.0, 3.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.25;
controls.maxDistance = 8;
controls.target.set(0, 0.95, 0);

/* lights — soft clinical key + cool rim over the env map */
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2, 4, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8fb8ff, 0.9);
rim.position.set(-3, 2, -2);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2436, 0.5));

/* a subtle ground shadow-catcher disc */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1.4, 64),
  new THREE.MeshBasicMaterial({ color: 0x0a1626, transparent: true, opacity: 0.55 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

/* ── state ─────────────────────────────────── */
const allMeshes = [];          // every bone mesh (right + midline + mirrored left)
const meshRegion = new Map();  // mesh -> region key
const pivotPairs = [];         // { right, left } pivots to keep mirrored
const joints = {};             // name -> { pivot, axis, sign }
let modelRoot = null;
let highlighted = null;
let modelBox = new THREE.Box3();

/* ── helpers ───────────────────────────────── */
// three.js sanitizes glTF node names (dots/spaces → underscores), so normalize
// everything to space-separated lowercase before matching.
const lower = (s) => (s || "").toLowerCase();
const norm = (s) => lower(s).replace(/[\s._]+/g, " ").trim();
// GLTFLoader keeps the unsanitized glTF name on userData.name — use it for matching.
const raw = (o) => (o && (o.userData.name || o.name)) || "";

function prettyName(raw) {
  let n = norm(raw).replace(/ [rl]$/i, "").trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function isHand(name) {
  const n = norm(name);
  if (n.includes("of foot")) return false;
  return /metacarpal|scaphoid|lunate|triquetrum|pisiform|trapezium|trapezoid|capitate|hamate|sesamoid bones of hand/.test(n)
    || (/phalanx/.test(n) && /finger/.test(n) && !n.includes("foot"));
}
function isFoot(name) {
  const n = norm(name);
  return /calcaneus|talus|navicular|cuboid|cuneiform|metatarsal|sesamoid bones of foot/.test(n)
    || (/phalanx/.test(n) && n.includes("foot"));
}
function isArm(name) {
  const n = norm(name);
  return /humerus|radius|ulna|clavicle|scapula/.test(n) || isHand(n);
}
function isLeg(name) {
  const n = norm(name);
  return /femur|patella|tibia|fibula|hip bone/.test(n) || isFoot(n);
}
function isSkull(name) {
  const n = norm(name);
  return /frontal|parietal|occipital|temporal|sphenoid|ethmoid|vomer|mandible|maxilla|zygomatic|nasal|lacrimal|palatine|concha|atlas|axis|incisor|canine|premolar|molar/.test(n);
}
function isThorax(name) {
  const n = norm(name);
  return /rib|sternum|manubrium|costal cart/.test(n);
}
function regionOf(n) {
  if (isArm(n)) return "arms";
  if (isLeg(n)) return "legs";
  if (isSkull(n)) return "skull";
  if (isThorax(n)) return "thorax";
  return "axial"; // vertebrae, sacrum, coccyx
}

function boneMaterial() {
  return new THREE.MeshStandardMaterial({
    color: BONE, roughness: 0.62, metalness: 0.0,
    emissive: 0x000000,
  });
}

/* world-space bounding box of all meshes whose bone name matches the predicate */
function boxOf(root, predicate) {
  const box = new THREE.Box3();
  let found = false;
  root.traverse((o) => {
    if (o.isMesh && predicate(o.userData.boneName || o.name)) { box.expandByObject(o); found = true; }
  });
  return found ? box : null;
}

/* ── build a poseable joint chain inside the right-bones group ── */
function buildJoint(parent, name, worldPivot, bones, axis = "x") {
  const pivot = new THREE.Object3D();
  pivot.name = "PIVOT_" + name;
  parent.add(pivot);
  // place pivot at the joint, expressed in parent's local space
  parent.worldToLocal(worldPivot);
  pivot.position.copy(worldPivot);
  // attach the distal bones (attach preserves world transform)
  bones.forEach((b) => b && pivot.attach(b));
  joints[name] = { pivot, axis };
  return pivot;
}

/* ── load model (plain glTF, no worker dependency) ─── */
const loader = new GLTFLoader();
loader.load(
  "assets/skeleton.glb",
  (gltf) => {
   try {
    modelRoot = gltf.scene;

    // bone material + register meshes on the original (right + midline) halves
    const midGroup = modelRoot.getObjectByName("Bones");
    const rightGroup = modelRoot.getObjectByName("Bones_right");
    const cartRight = modelRoot.getObjectByName("Cartilages_right");

    modelRoot.traverse((o) => {
      if (o.isMesh) {
        o.material = boneMaterial();
        o.castShadow = o.receiveShadow = false;
      }
    });

    scene.add(modelRoot);
    modelRoot.updateMatrixWorld(true); // pivots use worldToLocal — matrices must be current

    // tag every mesh with the name of its bone node (children of the three groups).
    // three.js names single-primitive meshes after the glTF mesh ("mesh.089"), not the
    // node, so we propagate the node name down for identification + grouping.
    for (const grp of [midGroup, rightGroup, cartRight]) {
      if (!grp) continue;
      for (const node of grp.children) {
        const bn = raw(node);
        node.traverse((o) => { o.userData.boneName = bn; });
      }
    }

    /* --- build joint chains from the right-bones nodes (local space) --- */
    if (rightGroup) {
      const kids = [...rightGroup.children]; // snapshot before reparenting
      const sel = (re) => kids.filter((k) => re.test(norm(raw(k))));
      const one = (re) => kids.find((k) => re.test(norm(raw(k))));
      const boxN = (node) => (node ? new THREE.Box3().setFromObject(node) : null);

      const humerus = sel(/^humerus r/);
      const radUlna = sel(/^(radius|ulna) r/);
      const handBones = kids.filter((k) => isHand(raw(k)));
      const femurPat = sel(/^(femur|patella) r/);
      const tibFib = sel(/^(tibia|fibula) r/);
      const footBones = kids.filter((k) => isFoot(raw(k)));

      const humBox = boxN(one(/^humerus r/));
      const radBox = boxN(one(/^radius r/));
      const femBox = boxN(one(/^femur r/));
      const tibBox = boxN(one(/^tibia r/));

      const top = (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      const bot = (b) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);

      // distal → proximal so attach order nests cleanly
      if (humBox && radBox) {
        const wrist = buildJoint(rightGroup, "wristR", bot(radBox), handBones, "x");
        const elbow = buildJoint(rightGroup, "elbowR", bot(humBox), [...radUlna, wrist], "x");
        buildJoint(rightGroup, "shoulderR", top(humBox), [...humerus, elbow], "z");
      }
      if (femBox && tibBox) {
        const ankle = buildJoint(rightGroup, "ankleR", bot(tibBox), footBones, "x");
        const knee = buildJoint(rightGroup, "kneeR", bot(femBox), [...tibFib, ankle], "x");
        buildJoint(rightGroup, "hipR", top(femBox), [...femurPat, knee], "x");
      }
    }

    /* --- mirror the right side to create the left --- */
    const mirror = new THREE.Group();
    mirror.name = "LeftMirror";
    mirror.scale.x = -1;
    modelRoot.add(mirror);

    const cloneSyncJoints = []; // { right, left }
    for (const grp of [rightGroup, cartRight]) {
      if (!grp) continue;
      const clone = grp.clone(true);
      clone.traverse((o) => {
        if (o.isMesh) o.material = boneMaterial();
      });
      mirror.add(clone);
      // pair pivots by name for live sync
      grp.traverse((o) => {
        if (o.name && o.name.startsWith("PIVOT_")) {
          const twin = clone.getObjectByName(o.name);
          if (twin) cloneSyncJoints.push({ right: o, left: twin });
        }
      });
    }
    pivotPairs.push(...cloneSyncJoints);

    /* --- register every visible mesh + its region --- */
    modelRoot.traverse((o) => {
      if (o.isMesh) {
        allMeshes.push(o);
        meshRegion.set(o, regionOf(o.userData.boneName || o.name));
      }
    });

    /* --- frame the model --- */
    modelBox.setFromObject(modelRoot);
    const center = modelBox.getCenter(new THREE.Vector3());
    const size = modelBox.getSize(new THREE.Vector3());
    controls.target.set(0, center.y, 0);
    camera.position.set(0, center.y + size.y * 0.15, size.y * 1.15);
    controls.update();

    loadingEl.classList.add("done");
    resize();
    setView("full", true);

    // optional shareable pose via URL hash, e.g. #pose=sitting
    const h = (location.hash.match(/pose=(\w+)/) || [])[1];
    if (h && PRESETS[h]) applyPreset(h);
   } catch (err) {
    console.error(err);
    loadingEl.querySelector("span").textContent = "Rig error: " + err.message;
   }
  },
  (xhr) => {
    if (xhr.total) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      loadingEl.querySelector("span").textContent = `Loading skeleton — ${pct}%`;
    }
  },
  (err) => {
    console.error(err);
    loadingEl.querySelector("span").textContent = "Could not load the model.";
  }
);

/* ── pose application ──────────────────────── */
const pose = { shoulderR: 0, shoulderSwing: 0, shoulderAdduct: 0, elbowR: 0, wristR: 0, hipR: 0, kneeR: 0 };

function applyPose() {
  const set = (name, axis, deg) => {
    const j = joints[name];
    if (!j) return;
    const e = new THREE.Euler();
    e[axis] = THREE.MathUtils.degToRad(deg);
    j.pivot.quaternion.setFromEuler(e);
  };
  // shoulder is a ball joint: flexion (x), horizontal adduction (y), abduction (z)
  if (joints.shoulderR) {
    const e = new THREE.Euler(
      THREE.MathUtils.degToRad(pose.shoulderSwing),
      THREE.MathUtils.degToRad(pose.shoulderAdduct),
      THREE.MathUtils.degToRad(pose.shoulderR)
    );
    joints.shoulderR.pivot.quaternion.setFromEuler(e);
  }
  set("elbowR", "x", pose.elbowR);
  set("wristR", "x", pose.wristR);
  set("hipR", "x", pose.hipR);
  set("kneeR", "x", pose.kneeR);
}

function syncMirror() {
  for (const p of pivotPairs) p.left.quaternion.copy(p.right.quaternion);
}

/* ── camera views ──────────────────────────── */
const tween = { active: false, t: 0, fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(), fromTgt: new THREE.Vector3(), toTgt: new THREE.Vector3() };

function focusBox(box, distMul = 1.6, instant = false) {
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 0.3;
  const dist = (radius / Math.tan((camera.fov * Math.PI) / 360)) * distMul + radius;
  const dir = new THREE.Vector3(0.25, 0.12, 1).normalize();
  const toPos = center.clone().add(dir.multiplyScalar(dist));
  if (instant || reduced) {
    camera.position.copy(toPos);
    controls.target.copy(center);
    controls.update();
    return;
  }
  tween.fromPos.copy(camera.position); tween.toPos.copy(toPos);
  tween.fromTgt.copy(controls.target); tween.toTgt.copy(center);
  tween.t = 0; tween.active = true;
}

function setView(view, instant = false) {
  if (!modelRoot) return;
  const whole = new THREE.Box3().setFromObject(modelRoot);
  let box = whole;
  const re = (r) => boxOf(modelRoot, (n) => r.test(norm(n)));
  switch (view) {
    case "skull": box = re(/frontal|parietal|occipital|mandible|maxilla|temporal/); break;
    case "thorax": box = re(/rib|sternum|manubrium/); break;
    case "spine": box = re(/vertebrae|sacrum|coccyx|atlas|axis/); break;
    case "pelvis": box = re(/hip bone|sacrum|coccyx/); break;
    case "hand": box = boxOf(modelRoot, isHand); break;
    case "foot": box = boxOf(modelRoot, isFoot); break;
    default: box = whole;
  }
  focusBox(box || whole, view === "full" ? 1.25 : 1.7, instant);
}

/* ── interaction: click to identify ────────── */
const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let down = null;

renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 6) return; // was a drag, not a click
  const r = renderer.domElement.getBoundingClientRect();
  ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ptr, camera);
  const hits = raycaster.intersectObjects(allMeshes, false);
  if (hits.length) identify(hits[0].object);
});

function identify(mesh) {
  if (highlighted) highlighted.material.emissive.setHex(0x000000);
  highlighted = mesh;
  mesh.material.emissive.setHex(TRACE);
  mesh.material.emissiveIntensity = 0.55;
  const bone = mesh.userData.boneName || mesh.name;
  idName.textContent = prettyName(bone);
  const reg = meshRegion.get(mesh) || "axial";
  const paired = /\.r\.?$/i.test(bone);
  idSub.textContent = `Region: ${reg}${paired ? " · paired (left & right)" : ""}`;
}

/* ── region isolation ──────────────────────── */
let activeRegion = "all";
function setRegion(region) {
  activeRegion = region;
  for (const m of allMeshes) {
    const r = meshRegion.get(m);
    const on = region === "all" || r === region;
    m.material.transparent = !on;
    m.material.opacity = on ? globalOpacity : Math.min(globalOpacity, 0.08);
    m.material.depthWrite = on;
  }
}

/* ── X-ray opacity ─────────────────────────── */
let globalOpacity = 1;
function setOpacity(v) {
  globalOpacity = v;
  setRegion(activeRegion);
}

/* ── animation loop ────────────────────────── */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function animate() {
  requestAnimationFrame(animate);
  if (tween.active) {
    tween.t = Math.min(tween.t + 0.025, 1);
    const e = easeOut(tween.t);
    camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
    controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
    if (tween.t >= 1) tween.active = false;
  }
  controls.update();
  syncMirror();
  renderer.render(scene, camera);
}
animate();

/* ════════════════════════════════════════════
   UI wiring
   ════════════════════════════════════════════ */
// view preset buttons
document.querySelectorAll("[data-view]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    setView(b.dataset.view);
  })
);

// region buttons
document.querySelectorAll("[data-region]").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("[data-region]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    setRegion(b.dataset.region);
  })
);

// pose sliders
const sliders = {
  shoulderR: "sl-shoulder", shoulderSwing: "sl-swing", elbowR: "sl-elbow",
  wristR: "sl-wrist", hipR: "sl-hip", kneeR: "sl-knee",
};
Object.entries(sliders).forEach(([key, id]) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("input", () => {
    pose[key] = +el.value;
    applyPose();
  });
});

// pose presets
const PRESETS = {
  anatomical: { shoulderR: 0, shoulderSwing: 0, shoulderAdduct: 0, elbowR: 0, wristR: 0, hipR: 0, kneeR: 0 },
  hands:      { shoulderR: -8, shoulderSwing: 18, shoulderAdduct: 40, elbowR: -102, wristR: 0, hipR: 0, kneeR: 0 },
  tpose:      { shoulderR: -90, shoulderSwing: 0, shoulderAdduct: 0, elbowR: 0, wristR: 0, hipR: 0, kneeR: 0 },
  armsup:     { shoulderR: -150, shoulderSwing: 0, shoulderAdduct: 0, elbowR: -10, wristR: 0, hipR: 0, kneeR: 0 },
  sitting:    { shoulderR: 0, shoulderSwing: 0, shoulderAdduct: 0, elbowR: -20, wristR: 0, hipR: -85, kneeR: 85 },
};
function applyPreset(name, animateSliders = true) {
  const p = PRESETS[name];
  if (!p) return;
  Object.assign(pose, p);
  applyPose();
  // reflect on sliders
  const m = { shoulderR: "sl-shoulder", shoulderSwing: "sl-swing", elbowR: "sl-elbow", wristR: "sl-wrist", hipR: "sl-hip", kneeR: "sl-knee" };
  Object.entries(m).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = pose[k]; });
}
document.querySelectorAll("[data-pose]").forEach((b) =>
  b.addEventListener("click", () => applyPreset(b.dataset.pose))
);

// display toggles
document.getElementById("opacity").addEventListener("input", (e) => setOpacity(+e.target.value / 100));
const spinBtn = document.getElementById("spin");
spinBtn.addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = 1.4;
  spinBtn.classList.toggle("active", controls.autoRotate);
});
document.getElementById("reset").addEventListener("click", () => {
  applyPreset("anatomical");
  setRegion("all");
  document.querySelectorAll("[data-region]").forEach((x) => x.classList.toggle("active", x.dataset.region === "all"));
  setView("full");
  document.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("active", x.dataset.view === "full"));
  document.getElementById("opacity").value = 100; setOpacity(1);
  if (highlighted) { highlighted.material.emissive.setHex(0x000000); highlighted = null; }
  idName.textContent = "Tap any bone";
  idSub.textContent = "Click a bone to identify it";
});

// mobile panel toggle
const panelToggle = document.getElementById("panel-toggle");
if (panelToggle) panelToggle.addEventListener("click", () => document.body.classList.toggle("panel-open"));
