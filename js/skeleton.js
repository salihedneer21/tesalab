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
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

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

    /* --- procedural soft-tissue body (muscle / fat / height / sex) --- */
    buildBody();
    updateBody();
    setSkeleton(false); // body is the subject; bones become an optional X-ray

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

    // default to a relaxed A-pose so arms read as separate from the torso
    pose.shoulderR = -16;
    applyPose();
    { const el = document.getElementById("sl-shoulder"); if (el) el.value = -16; }

    // optional shareable state via URL hash, e.g. #pose=sitting&muscle=80&fat=10&height=190&sex=90
    const hash = location.hash;
    const num = (k) => { const m = hash.match(new RegExp(k + "=(\\d+)")); return m ? +m[1] : null; };
    const g = num("sex"), ht = num("height"), mu = num("muscle"), ft = num("fat");
    if (g !== null || ht !== null || mu !== null || ft !== null) {
      if (g !== null) bodyParams.gender = g;
      if (ht !== null) bodyParams.height = ht;
      if (mu !== null) bodyParams.muscle = mu;
      if (ft !== null) bodyParams.fat = ft;
      Object.entries(bodySliders).forEach(([key, cfg]) => {
        const el = document.getElementById(cfg.id), out = document.getElementById(cfg.out);
        if (el) { el.value = bodyParams[key]; if (out) out.textContent = cfg.fmt(el.value); }
      });
      updateBody();
    }
    const p = (hash.match(/pose=(\w+)/) || [])[1];
    if (p && PRESETS[p]) applyPreset(p);
   } catch (err) {
    console.error(err);
    loadingEl.querySelector("span").textContent = "Rig error: " + err.message;
   }
  },
  (xhr) => {
    if (xhr.total) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      loadingEl.querySelector("span").textContent = `Building body — ${pct}%`;
    }
  },
  (err) => {
    console.error(err);
    loadingEl.querySelector("span").textContent = "Could not load the model.";
  }
);

/* ════════════════════════════════════════════
   Smooth procedural body (MarchingCubes metaballs)
   One organic skin surface re-melded over the
   skeleton every change, driven by the sliders.
   ════════════════════════════════════════════ */
const REF_HEIGHT = 170; // cm — the model's natural height
const bodyParams = { gender: 50, height: REF_HEIGHT, muscle: 35, fat: 25 };
let bodyVisible = true;
let heightScale = 1;
let bodyDirty = false;
const vWorld = (o) => o.getWorldPosition(new THREE.Vector3());

// MarchingCubes field: ball coords are [0,1]; the mesh renders local [-1,1].
const MC_RES = 72;
const MC_SUB = 12;             // subtract term (falloff)
const MC_SCALE = 1.22;         // half the field cube side, in world metres
const MC_POS = new THREE.Vector3(0, 1.0, 0);
let mc = null;
const limbChains = [];   // { prox, dist, kind }
const torsoAnchors = []; // { kind, center, size }

function skinMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xcf9e7f, roughness: 0.62, metalness: 0.02,
    transparent: true, opacity: 1, depthWrite: true,
  });
}

// world → [0,1] ball coords for the fixed field cube
function worldToBall(p) {
  return new THREE.Vector3(
    (p.x - MC_POS.x) / (2 * MC_SCALE) + 0.5,
    (p.y - MC_POS.y) / (2 * MC_SCALE) + 0.5,
    (p.z - MC_POS.z) / (2 * MC_SCALE) + 0.5
  );
}
function addBallWorld(p, rWorld) {
  const c = worldToBall(p);
  if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1 || c.z < 0 || c.z > 1) return;
  const rn = rWorld / (2 * MC_SCALE);
  const strength = rn * rn * (mc.isolation + MC_SUB);
  mc.addBall(c.x, c.y, c.z, strength, MC_SUB);
}

function limbProfile(kind, m, f) {
  // [proximal radius, distal radius] in world metres (nominal; field overlap adds ~25%)
  switch (kind) {
    case "upperarm": return [0.042 + m * 0.020 + f * 0.013, 0.032 + m * 0.013 + f * 0.010];
    case "forearm":  return [0.033 + m * 0.013 + f * 0.010, 0.023 + m * 0.006 + f * 0.007];
    case "thigh":    return [0.064 + m * 0.022 + f * 0.024, 0.044 + m * 0.014 + f * 0.016];
    case "calf":     return [0.043 + m * 0.016 + f * 0.013, 0.026 + m * 0.006 + f * 0.010];
  }
  return [0.04, 0.04];
}

function buildBody() {
  mc = new MarchingCubes(MC_RES, skinMaterial(), false, false, 120000);
  mc.isolation = 140;
  mc.position.copy(MC_POS);
  mc.scale.setScalar(MC_SCALE);
  mc.name = "Body";
  scene.add(mc);

  const cj = {};
  for (const p of pivotPairs) cj[p.right.name] = p.left;
  const leftOf = (rp) => cj[rp.name];
  const limbDefs = [
    ["shoulderR", "elbowR", "upperarm"],
    ["elbowR", "wristR", "forearm"],
    ["hipR", "kneeR", "thigh"],
    ["kneeR", "ankleR", "calf"],
  ];
  for (const [a, b, kind] of limbDefs) {
    if (!joints[a] || !joints[b]) continue;
    for (const side of ["R", "L"]) {
      const prox = side === "R" ? joints[a].pivot : leftOf(joints[a].pivot);
      const dist = side === "R" ? joints[b].pivot : leftOf(joints[b].pivot);
      if (prox && dist) limbChains.push({ prox, dist, kind });
    }
  }

  // static torso landmarks from bone boxes (modelRoot space at scale 1)
  const skull = boxOf(modelRoot, isSkull);
  const ribs = boxOf(modelRoot, (n) => /rib|sternum|manubrium/.test(norm(n)));
  const pelvis = boxOf(modelRoot, (n) => /hip bone|sacrum/.test(norm(n)));
  const C = (b) => b.getCenter(new THREE.Vector3());
  const Sz = (b) => b.getSize(new THREE.Vector3());
  if (skull) torsoAnchors.push({ kind: "head", center: C(skull), size: Sz(skull) });
  if (skull && ribs) torsoAnchors.push({ kind: "neck", center: new THREE.Vector3(0, skull.min.y - 0.015, C(skull).z), size: Sz(ribs) });
  if (ribs) {
    const c = C(ribs), s = Sz(ribs);
    torsoAnchors.push({ kind: "chestTop", center: new THREE.Vector3(0, c.y + s.y * 0.30, c.z), size: s });
    torsoAnchors.push({ kind: "chest", center: new THREE.Vector3(0, c.y + s.y * 0.05, c.z), size: s });
    torsoAnchors.push({ kind: "abdomen", center: new THREE.Vector3(0, c.y - s.y * 0.32, c.z), size: s });
  }
  if (pelvis) torsoAnchors.push({ kind: "hips", center: C(pelvis), size: Sz(pelvis) });
  // shoulder + hip joint balls knit the limbs to the trunk
}

function rebuildField() {
  if (!mc) return;
  heightScale = bodyParams.height / REF_HEIGHT;
  modelRoot.scale.setScalar(heightScale);
  modelRoot.updateMatrixWorld(true);
  syncMirror();
  modelRoot.updateMatrixWorld(true);

  const m = bodyParams.muscle / 100;
  const f = bodyParams.fat / 100;
  const g = bodyParams.gender / 100; // 0 female · 1 male
  const hs = heightScale;

  mc.reset();

  // limbs — dense balls along each bone segment, tapered proximal → distal
  for (const ch of limbChains) {
    const p = vWorld(ch.prox), q = vWorld(ch.dist);
    const [rp, rd] = limbProfile(ch.kind, m, f);
    const len = p.distanceTo(q);
    const steps = Math.max(2, Math.ceil(len / (rp * 1.1 * hs))); // ~1 ball per radius
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pos = p.clone().lerp(q, t);
      addBallWorld(pos, (rp + (rd - rp) * t) * hs);
    }
  }

  // shoulder + hip junction balls (connect limbs to trunk)
  const cj = {};
  for (const p of pivotPairs) cj[p.right.name] = p.left;
  for (const key of ["shoulderR", "hipR"]) {
    const j = joints[key];
    if (!j) continue;
    const r = key === "shoulderR" ? (0.06 + m * 0.02 + f * 0.015) : (0.09 + (1 - g) * 0.02 + f * 0.03);
    addBallWorld(vWorld(j.pivot), r * hs);
    const tw = cj["PIVOT_" + key];
    if (tw) addBallWorld(vWorld(tw), r * hs);
  }

  // hands + feet caps so limbs don't taper to points
  for (const side of ["R", "L"]) {
    const get = (n) => (side === "R" ? joints[n] && joints[n].pivot : cj["PIVOT_" + n]);
    const wr = get("wristR"), el = get("elbowR");
    if (wr && el) {
      const w = vWorld(wr), dir = w.clone().sub(vWorld(el)).normalize();
      addBallWorld(w.clone().add(dir.clone().multiplyScalar(0.03 * hs)), (0.05 + f * 0.012) * hs);
      addBallWorld(w.clone().add(dir.clone().multiplyScalar(0.10 * hs)), (0.040 + f * 0.008) * hs);
    }
    const an = get("ankleR");
    if (an) {
      const a = vWorld(an);
      addBallWorld(a, (0.05 + f * 0.01) * hs);
      addBallWorld(a.clone().add(new THREE.Vector3(0, -0.025 * hs, 0.07 * hs)), 0.046 * hs);
      addBallWorld(a.clone().add(new THREE.Vector3(0, -0.035 * hs, 0.14 * hs)), 0.038 * hs);
    }
  }

  // torso / head — overlapping balls along the trunk
  for (const a of torsoAnchors) {
    const z = a.size;
    const c = a.center.clone().multiplyScalar(hs);
    let r, halfW = 0;
    switch (a.kind) {
      case "head": r = (z.x * 0.44 + 0.008 + f * 0.005) * hs; break;
      case "neck": r = (0.044 + m * 0.006 + f * 0.005) * hs; break;
      case "chestTop": r = (z.x * 0.30 * (0.92 + g * 0.18) + m * 0.014) * hs; halfW = (z.x * 0.15 * (0.9 + g * 0.22)) * hs; break;
      case "chest": r = (z.x * 0.28 * (0.9 + g * 0.12) + m * 0.016 + f * 0.014) * hs; halfW = (z.x * 0.12) * hs; break;
      case "abdomen": r = (z.x * 0.23 + f * 0.05 - m * 0.006) * hs; halfW = (z.x * 0.075 + f * 0.014) * hs; break;
      case "hips": r = (z.x * 0.22 * (1 + (1 - g) * 0.18) + f * 0.034) * hs; halfW = (z.x * 0.15 * (1 + (1 - g) * 0.22) + f * 0.02) * hs; break;
      default: r = 0.05 * hs;
    }
    if (halfW > 0.001) {
      // two side-by-side balls give the trunk width without ballooning depth
      addBallWorld(c.clone().add(new THREE.Vector3(halfW, 0, 0)), r);
      addBallWorld(c.clone().add(new THREE.Vector3(-halfW, 0, 0)), r);
    } else {
      addBallWorld(c, r);
    }
  }

  mc.update();
  mc.visible = bodyVisible;
}

function updateBody() { bodyDirty = true; }
function followBody() { if (bodyDirty) { rebuildField(); bodyDirty = false; } }

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
  bodyDirty = true; // re-meld the skin to the new pose
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

/* ── interaction: click to pin a 3D label ──── */
const raycaster = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let down = null;
const pins = [];                 // { bone, local: Vector3, el }
const labelLayer = document.getElementById("labels");
const projV = new THREE.Vector3();

// raycast the bones (the ray passes through the skin to the bone beneath).
// the raycaster skips invisible objects, so temporarily reveal bones for the
// synchronous cast — no render happens in between, so the user never sees them.
function raycastBones() {
  camera.updateMatrixWorld();
  modelRoot.updateMatrixWorld(true);
  const restore = !skeletonVisible;
  if (restore) for (const m of allMeshes) m.visible = true;
  raycaster.setFromCamera(ptr, camera);
  const hits = raycaster.intersectObjects(allMeshes, false);
  if (restore) for (const m of allMeshes) m.visible = false;
  return hits;
}

renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 6) return; // was a drag, not a click
  const r = renderer.domElement.getBoundingClientRect();
  ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hits = raycastBones();
  if (hits.length) pinLabel(hits[0].object, hits[0].point);
});

function pinLabel(mesh, worldPoint) {
  const bone = mesh.userData.boneName || mesh.name;
  const reg = meshRegion.get(mesh) || "axial";
  const el = document.createElement("button");
  el.className = "pin";
  el.innerHTML = `<span class="pin__dot"></span><span class="pin__name">${prettyName(bone)}</span><span class="pin__reg">${reg}</span>`;
  el.title = "Remove label";
  el.addEventListener("click", () => {
    const i = pins.findIndex((p) => p.el === el);
    if (i >= 0) { pins.splice(i, 1); el.remove(); }
  });
  labelLayer.appendChild(el);
  pins.push({ bone: mesh, local: mesh.worldToLocal(worldPoint.clone()), el });
}

function clearPins() {
  pins.forEach((p) => p.el.remove());
  pins.length = 0;
}

function updateLabels() {
  if (!pins.length) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const p of pins) {
    p.bone.localToWorld(projV.copy(p.local));
    projV.project(camera);
    const behind = projV.z > 1;
    if (behind) { p.el.style.display = "none"; continue; }
    p.el.style.display = "";
    p.el.style.transform = `translate(-50%, -120%) translate(${(projV.x * 0.5 + 0.5) * w}px, ${(-projV.y * 0.5 + 0.5) * h}px)`;
  }
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

/* ── skin opacity + skeleton visibility ────── */
let globalOpacity = 1;
let skeletonVisible = false;
function setSkinOpacity(v) {
  if (!mc) return;
  mc.material.opacity = v;
  mc.material.transparent = v < 0.99;
  mc.material.depthWrite = v >= 0.99;
}
function setSkeleton(v) {
  skeletonVisible = v;
  for (const m of allMeshes) m.visible = v;
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
  followBody();
  updateLabels();
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

// body composition sliders
const bodySliders = {
  gender: { id: "sl-gender", out: "v-gender", fmt: (v) => `${v}%` },
  height: { id: "sl-height", out: "v-height", fmt: (v) => `${v} cm` },
  muscle: { id: "sl-muscle", out: "v-muscle", fmt: (v) => `${v}` },
  fat: { id: "sl-fat", out: "v-fat", fmt: (v) => `${v}` },
};
Object.entries(bodySliders).forEach(([key, cfg]) => {
  const el = document.getElementById(cfg.id);
  const out = document.getElementById(cfg.out);
  if (!el) return;
  el.addEventListener("input", () => {
    bodyParams[key] = +el.value;
    if (out) out.textContent = cfg.fmt(el.value);
    updateBody();
  });
});
const bodyToggle = document.getElementById("body-toggle");
if (bodyToggle) bodyToggle.addEventListener("click", () => {
  bodyVisible = !bodyVisible;
  if (mc) mc.visible = bodyVisible;
  bodyToggle.classList.toggle("active", bodyVisible);
  bodyToggle.textContent = bodyVisible ? "Body: on" : "Body: off";
});
const skelToggle = document.getElementById("skel-toggle");
if (skelToggle) skelToggle.addEventListener("click", () => {
  setSkeleton(!skeletonVisible);
  skelToggle.classList.toggle("active", skeletonVisible);
  skelToggle.textContent = skeletonVisible ? "Skeleton: on" : "Skeleton: off";
});
const clearBtn = document.getElementById("clear-labels");
if (clearBtn) clearBtn.addEventListener("click", clearPins);

function resetBody() {
  Object.assign(bodyParams, { gender: 50, height: REF_HEIGHT, muscle: 35, fat: 25 });
  Object.entries(bodySliders).forEach(([key, cfg]) => {
    const el = document.getElementById(cfg.id);
    const out = document.getElementById(cfg.out);
    if (el) { el.value = bodyParams[key]; if (out) out.textContent = cfg.fmt(el.value); }
  });
  bodyVisible = true;
  if (mc) mc.visible = true;
  if (bodyToggle) { bodyToggle.classList.add("active"); bodyToggle.textContent = "Body: on"; }
  updateBody();
}

// display toggles
document.getElementById("opacity").addEventListener("input", (e) => {
  setSkinOpacity(+e.target.value / 100);
  const out = document.getElementById("v-skin");
  if (out) out.textContent = `${e.target.value}%`;
});
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
  document.getElementById("opacity").value = 100; setSkinOpacity(1);
  setSkeleton(false);
  if (skelToggle) { skelToggle.classList.remove("active"); skelToggle.textContent = "Skeleton: off"; }
  resetBody();
  clearPins();
});

// mobile panel toggle
const panelToggle = document.getElementById("panel-toggle");
if (panelToggle) panelToggle.addEventListener("click", () => document.body.classList.toggle("panel-open"));
