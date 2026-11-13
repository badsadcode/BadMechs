import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { strToU8, zipSync } from 'fflate';
import { generate, GenResult } from '../core/families';
import type { MechNode, Pose } from '../core/model';
import { SCHEMES } from '../core/palette';
import { defaultRecipe, Family, FAMILIES, MechRecipe, MechRole } from '../core/recipe';
import { validate } from '../core/validate';
import { calibrateGait } from '../controller/calibrate';
import { RigWalker } from '../controller/walker';
import { exportGlb } from '../export/gltf';
import { buildPackage, slug } from '../export/package';
import { collisionBoxes, rigSidecar } from '../export/rig';
import { exportObj, exportUsda } from '../export/static';
import { buildMechView, MechView } from '../render/threeMech';
import BRIDGE from '../../tools/blender_bridge.py?raw';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ROLES: MechRole[] = ['combat', 'scout', 'industrial', 'salvage', 'hauler', 'explorer'];

// ───────────────────────────────────────────────────────────── state ──
let recipe: MechRecipe = loadFromHash() ?? { ...defaultRecipe('biped', 7301), scheme: 'olive', bulk: 0.65 };
let result: GenResult;
let view: MechView | null = null;
let lod: 0 | 1 | 2 = 0;
let selected: string | null = null;
let mode: 'rest' | 'flex' | 'walk' = 'rest';
const manualPose: Pose = {};
const toggles = { armor: true, xray: false, joints: false, collision: false, human: true };
const hidden = new Set<string>();
let walker: RigWalker | null = null;
let walkScene: THREE.Object3D | null = null;

// ───────────────────────────────────────────────────────────── scene ──
const canvas = $<HTMLCanvasElement>('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new THREE.HemisphereLight(0xdfe6ee, 0x3a3326, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(400, 400, 0x6b6552, 0x3b3d40);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.35;
scene.add(grid);
const human = makeHuman();
scene.add(human);
const overlay = new THREE.Group();
scene.add(overlay);
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffc23d);
selBox.visible = false;
scene.add(selBox);

function makeHuman() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.7 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    g.add(me);
  };
  add(new THREE.CapsuleGeometry(0.07, 0.72, 4, 8), -0.1, 0.43);
  add(new THREE.CapsuleGeometry(0.07, 0.72, 4, 8), 0.1, 0.43);
  add(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), 0, 1.15);
  add(new THREE.SphereGeometry(0.12, 12, 10), 0, 1.66);
  add(new THREE.CapsuleGeometry(0.05, 0.6, 4, 8), -0.26, 1.1);
  add(new THREE.CapsuleGeometry(0.05, 0.6, 4, 8), 0.26, 1.1);
  g.name = 'human_1.8m';
  return g;
}

function resize() {
  const r = canvas.parentElement!.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement!);

// ─────────────────────────────────────────────────────────── rebuild ──
function rebuild(frame = false) {
  stopWalk();
  result = generate(recipe);
  const mech = result.mech;
  if (view) {
    scene.remove(view.root);
    view.dispose();
  }
  view = buildMechView(mech, lod);
  scene.add(view.root);
  if (selected && !view.objects.has(selected)) selected = null;
  for (const k of Object.keys(manualPose)) if (!view.objects.has(k)) delete manualPose[k];
  applyVisibility();
  buildOverlays();
  view.setPose(manualPose);
  human.position.set(mech.stats.width / 2 + 1.2, 0, 0);
  const size = Math.max(mech.stats.height, mech.stats.width, mech.stats.length);
  sun.position.set(size * 0.8, size * 1.6, size * 1.1);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -size;
  sun.shadow.camera.right = sun.shadow.camera.top = size;
  sun.shadow.camera.far = size * 5;
  sun.shadow.camera.updateProjectionMatrix();
  if (frame) frameCamera();
  renderUI();
  writeHash();
  if (mode === 'walk') startWalk();
  scheduleValidation();
}

function frameCamera() {
  const s = result.mech.stats;
  const size = Math.max(s.height, s.width * 0.8, s.length * 0.8);
  controls.target.set(0, s.height * 0.45, 0);
  camera.position.set(size * 1.25, s.height * 0.75 + size * 0.25, size * 1.6);
  camera.near = size * 0.005;
  camera.far = size * 60;
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────── visibility ──
const ghost = new THREE.MeshStandardMaterial({ color: 0x8aa0b0, transparent: true, opacity: 0.1, depthWrite: false, roughness: 1 });
function nodeOf(name: string): MechNode {
  return result.mech.nodes.find((n) => n.name === name)!;
}
function inInterior(n: MechNode): boolean {
  for (let p: MechNode | undefined = n; p; p = p.parent ? nodeOf(p.parent) : undefined) if (p.component === 'interior') return true;
  return false;
}
function applyVisibility() {
  if (!view) return;
  for (const n of result.mech.nodes) {
    const o = view.objects.get(n.name)!;
    const ownVisible = !hidden.has(n.name) && !(n.component === 'armor' && !toggles.armor);
    const interior = inInterior(n);
    for (const c of o.children) {
      if (!(c as THREE.Mesh).isMesh) continue;
      const mesh = c as THREE.Mesh;
      if (!mesh.userData.mat) mesh.userData.mat = mesh.material;
      mesh.visible = ownVisible;
      mesh.material = toggles.xray && !interior ? ghost : mesh.userData.mat;
      mesh.castShadow = !toggles.xray;
    }
  }
  for (const { mesh } of view.cables) mesh.visible = !toggles.xray;
  human.visible = toggles.human;
}

function buildOverlays() {
  overlay.clear();
  if (!view) return;
  for (const o of view.root.children) if (o.userData.overlay) view.root.remove(o);
  const mech = result.mech;
  const scale = mech.stats.height;
  if (toggles.joints) {
    const colors: Record<string, number> = { locomotion: 0xffb12e, manipulation: 0x5ec8ff, aim: 0xff5d5d, torso: 0xb68cff, access: 0x7ee08a, tool: 0xf0f0f0, suspension: 0xf0f0f0 };
    for (const n of mech.nodes) {
      if (!n.joint) continue;
      const g = new THREE.Group();
      g.userData.overlay = true;
      const c = colors[n.joint.purpose] ?? 0xffffff;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.008, 10, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
      dot.renderOrder = 10;
      const axis = n.joint.axis === 'x' ? new THREE.Vector3(1, 0, 0) : n.joint.axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const arrow = new THREE.ArrowHelper(axis, new THREE.Vector3(), scale * 0.05, c, scale * 0.012, scale * 0.008);
      arrow.traverse((x) => {
        const m = (x as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.depthTest = false;
        x.renderOrder = 10;
      });
      g.add(dot, arrow);
      view.objects.get(n.name)!.add(g);
    }
  }
  if (toggles.collision) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x48ff7a, wireframe: true, transparent: true, opacity: 0.6 });
    for (const b of collisionBoxes(mech)) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.halfExtents[0] * 2, b.halfExtents[1] * 2, b.halfExtents[2] * 2), mat);
      m.position.set(...b.center);
      m.quaternion.set(...b.rotation);
      m.userData.overlay = true;
      view.objects.get(b.body)!.add(m);
    }
  }
}
function clearOverlays() {
  if (!view) return;
  const rm: THREE.Object3D[] = [];
  view.root.traverse((o) => o.userData.overlay && rm.push(o));
  for (const o of rm) o.parent?.remove(o);
}

// ──────────────────────────────────────────────────────────── modes ──
let clock = 0;
function poseForFlex(t: number): Pose {
  const p: Pose = {};
  for (const n of result.mech.nodes) {
    if (!n.joint) continue;
    const { min, max } = n.joint;
    const ph = (n.name.length * 1.7) % (Math.PI * 2);
    if (n.tags.includes('continuous')) p[n.name] = t * 3;
    else p[n.name] = (min + max) / 2 + ((max - min) / 2) * 0.9 * Math.sin(t * 1.3 + ph);
  }
  return p;
}

async function startWalk() {
  stopWalk();
  if (!view) return;
  const mech = result.mech;
  toast('Walk test: exporting GLB → loading it back → walking it with only the rig file…');
  calibrateGait(mech);
  const glb = exportGlb(mech, { lod });
  const rig = JSON.parse(JSON.stringify(rigSidecar(mech, recipe)));
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '');
  if (mode !== 'walk') return;
  walkScene = gltf.scene;
  walkScene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  scene.add(walkScene);
  view.root.visible = false;
  walker = new RigWalker(walkScene, rig);
  toast(`Walking the exported file: ${rig.legs.length} legs, ${rig.gait.type}, ${walker.speed.toFixed(1)} m/s`);
}
function stopWalk() {
  if (walkScene) scene.remove(walkScene);
  walkScene = null;
  walker = null;
  if (view) view.root.visible = true;
}

// ─────────────────────────────────────────────────────────── picking ──
const ray = new THREE.Raycaster();
let downAt = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || !view || mode === 'walk') return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObject(view.root, true).filter((h) => h.object.visible && h.object.userData.pickNode && (h.object as THREE.Mesh).material !== ghost);
  select(hits.length ? (hits[0].object.userData.pickNode as string) : null);
});

function select(name: string | null) {
  selected = name;
  renderTree();
  renderInspector();
  updateSelBox();
  if (name) document.querySelector(`.tn[data-n="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest' });
}
function updateSelBox() {
  if (!view || !selected) {
    selBox.visible = false;
    return;
  }
  const o = view.objects.get(selected)!;
  const box = new THREE.Box3();
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh && c.visible) box.expandByObject(c);
  });
  if (box.isEmpty()) box.setFromCenterAndSize(o.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.2, 0.2, 0.2));
  selBox.box.copy(box);
  selBox.visible = true;
}

// ──────────────────────────────────────────────────────────────── UI ──
function renderUI() {
  // families
  const fam = $('families');
  fam.innerHTML = '';
  for (const f of FAMILIES) {
    const b = document.createElement('button');
    b.className = 'fam' + (f.id === recipe.family ? ' on' : '');
    b.innerHTML = `<b>${f.label}</b><span>${f.blurb}</span>`;
    b.onclick = () => {
      const keep = { scheme: recipe.scheme, scale: recipe.scale, bulk: recipe.bulk, seed: recipe.seed };
      recipe = { ...defaultRecipe(f.id as Family, keep.seed), ...keep, name: '' };
      selected = null;
      rebuild(true);
    };
    fam.appendChild(b);
  }
  const role = $<HTMLSelectElement>('in-role');
  role.innerHTML = ROLES.map((r) => `<option value="${r}" ${r === recipe.role ? 'selected' : ''}>${r}</option>`).join('');
  $<HTMLInputElement>('in-seed').value = String(recipe.seed);
  $<HTMLInputElement>('in-scale').value = String(recipe.scale);
  $<HTMLInputElement>('in-bulk').value = String(recipe.bulk);
  $('out-scale').textContent = recipe.scale.toFixed(2);
  $('out-bulk').textContent = recipe.bulk.toFixed(2);
  const nm = $<HTMLInputElement>('in-name');
  nm.value = recipe.name;
  nm.placeholder = result.mech.name;
  const sw = $('swatches');
  sw.innerHTML = '';
  for (const [id, s] of Object.entries(SCHEMES)) {
    const b = document.createElement('button');
    b.className = 'sw' + (id === recipe.scheme ? ' on' : '');
    b.title = s.label;
    b.style.background = `linear-gradient(135deg, ${s.paint} 0 55%, ${s.paint2} 55% 80%, ${s.hazard} 80%)`;
    b.onclick = () => {
      recipe.scheme = id;
      rebuild();
    };
    sw.appendChild(b);
  }
  renderOptions();
  renderTree();
  renderInspector();
  renderStats();
}

function renderOptions() {
  const el = $('options');
  el.innerHTML = '';
  const bySlot = new Map<string, typeof result.options>();
  for (const o of result.options) {
    const slot = o.slot.split('.')[0] === 'arms' && o.slot !== 'arms' ? o.slot : o.slot;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(o);
  }
  for (const [slot, opts] of bySlot) {
    const g = document.createElement('div');
    g.className = 'optgroup';
    const head = document.createElement('div');
    head.className = 'gh';
    head.innerHTML = `<span>${slot}</span>`;
    const rr = document.createElement('button');
    rr.className = 'mini';
    rr.textContent = '🎲';
    rr.title = `Re-roll ${slot} only (pinned choices stay)`;
    rr.onclick = () => reroll(slot);
    head.appendChild(rr);
    g.appendChild(head);
    for (const o of opts) {
      const row = document.createElement('div');
      row.className = 'opt';
      const label = document.createElement('span');
      label.textContent = o.label;
      row.appendChild(label);
      let input: HTMLElement;
      if (o.choices) {
        const s = document.createElement('select');
        s.innerHTML = o.choices.map((c) => `<option ${c === o.value ? 'selected' : ''}>${c}</option>`).join('');
        s.onchange = () => setOverride(o.key, s.value);
        input = s;
      } else if (typeof o.value === 'boolean') {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = o.value;
        c.onchange = () => setOverride(o.key, c.checked);
        input = c;
      } else {
        const r = document.createElement('input');
        r.type = 'range';
        r.min = String(o.min);
        r.max = String(o.max);
        r.step = Number.isInteger(o.min) && Number.isInteger(o.max) && o.max! - o.min! < 10 ? '1' : '0.5';
        r.value = String(o.value);
        r.title = String(Math.round(Number(o.value) * 10) / 10);
        r.onchange = () => setOverride(o.key, Number(r.value));
        input = r;
      }
      row.appendChild(input);
      const pin = document.createElement('button');
      pin.className = 'mini' + (o.overridden ? ' pinned' : '');
      pin.textContent = '📌';
      pin.title = o.overridden ? 'Pinned: click to let the dice decide again' : 'Pin this choice';
      pin.onclick = () => {
        if (o.overridden) delete recipe.overrides[o.key];
        else recipe.overrides[o.key] = o.value;
        rebuild();
      };
      row.appendChild(pin);
      g.appendChild(row);
    }
    el.appendChild(g);
  }
  if (!bySlot.size) el.innerHTML = '<p class="dim">No random choices for this family.</p>';
}

function setOverride(key: string, v: string | number | boolean) {
  recipe.overrides[key] = v;
  rebuild();
}
function reroll(slot: string) {
  recipe.rerolls[slot] = (recipe.rerolls[slot] ?? 0) + 1;
  // the cosmetic sub-streams follow their slot
  recipe.rerolls[slot + '.style'] = recipe.rerolls[slot];
  rebuild();
  toast(`Re-rolled ${slot}. Everything else (and anything pinned) stayed put.`);
}

function renderTree() {
  const el = $('tree');
  const filter = $<HTMLInputElement>('tree-filter').value.trim().toLowerCase();
  const mech = result.mech;
  const depth = new Map<string, number>();
  const parts: string[] = [];
  for (const n of mech.nodes) {
    const d = n.parent ? depth.get(n.parent)! + 1 : 0;
    depth.set(n.name, d);
    if (filter && !n.name.toLowerCase().includes(filter) && !n.system.includes(filter)) continue;
    const icon = n.joint ? '⟳' : n.role === 'actuator' ? '⇄' : n.role === 'socket' ? '◎' : n.role === 'hatch' ? '▭' : n.component ? '·' : '▪';
    const extra = n.joint ? `${n.joint.kind}` : n.component ?? n.role;
    parts.push(`<div class="tn${n.name === selected ? ' sel' : ''}" data-n="${n.name}" style="padding-left:${4 + (filter ? 0 : d * 10)}px"><span class="k">${icon}</span>${n.name} <span class="r">${extra}</span></div>`);
  }
  el.innerHTML = parts.join('');
}
$('tree').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('.tn') as HTMLElement | null;
  if (t) select(t.dataset.n!);
});
$('tree-filter').addEventListener('input', renderTree);

function slotForSystem(sys: string): string {
  if (sys.startsWith('leg')) return 'legs';
  if (sys === 'arm.L') return 'arms.L';
  if (sys === 'arm.R') return 'arms.R';
  if (sys.startsWith('pod')) return 'pods';
  if (['crane', 'turret', 'sensor', 'interior'].includes(sys)) return 'deck';
  return sys;
}

function renderInspector() {
  const el = $('inspector');
  if (!selected) {
    el.innerHTML = '<p class="dim">Click a part in the viewport or the list. Joints get a slider.</p>';
    return;
  }
  const n = nodeOf(selected);
  // the moving part this belongs to
  let link: MechNode = n;
  while (!link.joint && link.parent) link = nodeOf(link.parent);
  const act = result.mech.actuators.find((a) => a.baseNode === n.name || a.endNode === n.name);
  const leg = result.mech.legs.find((l) => l.joints.includes(link.name));
  let html = `<div class="name">${n.name}</div><dl>`;
  html += `<dt>role</dt><dd>${n.role}${n.component ? ' / ' + n.component : ''}</dd><dt>system</dt><dd>${n.system}</dd><dt>parent</dt><dd>${n.parent ?? '—'}</dd>`;
  html += `<dt>pivot</dt><dd>${n.position.map((v) => v.toFixed(3)).join(', ')}</dd>`;
  if (link.joint) {
    const j = link.joint;
    html += `<dt>joint</dt><dd>${link.name === n.name ? '' : link.name + ' → '}${j.kind} (${j.purpose})</dd><dt>axis</dt><dd>local ${j.axis.toUpperCase()}</dd><dt>limits</dt><dd>${((j.min * 180) / Math.PI).toFixed(1)}° … ${((j.max * 180) / Math.PI).toFixed(1)}°${link.tags.includes('continuous') ? ' (continuous)' : ''}</dd>`;
    const fit = result.fits.find((f) => f.joint === link.name);
    if (fit) html += `<dt>fitted</dt><dd>trimmed from ${fit.before.map((x) => ((x * 180) / Math.PI).toFixed(0) + '°').join('…')} (would hit ${fit.blockedBy})</dd>`;
  }
  if (act) html += `<dt>piston</dt><dd>${act.name}: ${act.minLength.toFixed(2)}–${act.maxLength.toFixed(2)} m, drives ${act.drives}</dd>`;
  if (leg) html += `<dt>leg chain</dt><dd>${leg.name}: ${leg.joints.length} joints, ${leg.style}</dd>`;
  html += '</dl>';
  if (link.joint) {
    const j = link.joint;
    const v = manualPose[link.name] ?? 0;
    html += `<div class="slider"><input id="jslider" type="range" min="${j.min}" max="${j.max}" step="0.001" value="${v}" ${mode !== 'rest' ? 'disabled' : ''}/><output id="jout">${((v * 180) / Math.PI).toFixed(1)}°</output></div>`;
  }
  html += `<div class="btns"><button class="mini" id="btn-hide">${hidden.has(n.name) ? 'Show' : 'Hide'} part</button><button class="mini" id="btn-reroll-part">🎲 Re-roll ${slotForSystem(n.system)}</button><button class="mini" id="btn-reset-pose">Reset pose</button></div>`;
  el.innerHTML = html;
  const s = document.getElementById('jslider') as HTMLInputElement | null;
  if (s && link.joint) {
    s.oninput = () => {
      manualPose[link.name] = Number(s.value);
      $('jout').textContent = ((Number(s.value) * 180) / Math.PI).toFixed(1) + '°';
      view?.setPose(manualPose);
      updateSelBox();
    };
  }
  $('btn-hide').onclick = () => {
    if (hidden.has(n.name)) hidden.delete(n.name);
    else hidden.add(n.name);
    applyVisibility();
    renderInspector();
    updateSelBox();
  };
  $('btn-reroll-part').onclick = () => reroll(slotForSystem(n.system));
  $('btn-reset-pose').onclick = () => {
    for (const k of Object.keys(manualPose)) delete manualPose[k];
    view?.setPose(manualPose);
    renderInspector();
    updateSelBox();
  };
}

function renderStats() {
  const m = result.mech;
  let tris = 0;
  view?.root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if ((o as THREE.Mesh).isMesh && g?.index) tris += g.index.count / 3;
  });
  const joints = m.nodes.filter((n) => n.joint).length;
  $('stats').innerHTML = `<b>${m.name}</b> · ${m.family} · ${m.stats.sizeClass} · <b>${m.stats.height} m</b> tall · ~${m.stats.estimatedMassTonnes} t · ${m.nodes.length} nodes · <b>${joints}</b> joints · ${m.legs.length} legs · ${m.actuators.length} pistons · ${m.cables.length} hoses · ${Math.round(tris).toLocaleString()} tris (LOD${lod})`;
}

let valTimer = 0;
function scheduleValidation() {
  clearTimeout(valTimer);
  $('validation').innerHTML = '<p class="dim">checking…</p>';
  valTimer = window.setTimeout(() => {
    const rep = validate(result.mech, { randomPoses: 16 });
    const icon = { ok: '✓', info: 'i', warn: '!', error: '✗' } as const;
    const fits = result.fits.length ? `<div class="chk info"><i>i</i><span>${result.fits.length} joint limits auto-trimmed so parts don't clip (see inspector)</span></div>` : '';
    $('validation').innerHTML =
      rep.checks
        .sort((a, b) => ['error', 'warn', 'info', 'ok'].indexOf(a.severity) - ['error', 'warn', 'info', 'ok'].indexOf(b.severity))
        .map((c) => `<div class="chk ${c.severity}"><i>${icon[c.severity]}</i><span>${c.message}</span></div>`)
        .join('') + fits;
    const b = $('val-badge');
    const sev = rep.counts.error ? 'error' : rep.counts.warn ? 'warn' : 'ok';
    b.className = 'badge ' + sev;
    b.textContent = rep.counts.error ? `${rep.counts.error} errors` : rep.counts.warn ? `${rep.counts.warn} warnings` : 'all good';
  }, 60);
}

// basics
$<HTMLSelectElement>('in-role').onchange = (e) => {
  recipe.role = (e.target as HTMLSelectElement).value as MechRole;
  rebuild();
};
$<HTMLInputElement>('in-seed').onchange = (e) => {
  recipe.seed = Number((e.target as HTMLInputElement).value) | 0;
  rebuild();
};
$('btn-seed').onclick = () => {
  recipe.seed = (Math.random() * 1e6) | 0;
  recipe.rerolls = {};
  rebuild();
};
for (const k of ['scale', 'bulk'] as const) {
  const el = $<HTMLInputElement>(`in-${k}`);
  el.oninput = () => ($(`out-${k}`).textContent = Number(el.value).toFixed(2));
  el.onchange = () => {
    recipe[k] = Number(el.value);
    rebuild(k === 'scale');
  };
}
$<HTMLInputElement>('in-name').onchange = (e) => {
  recipe.name = (e.target as HTMLInputElement).value.trim();
  rebuild();
};

// top bar
$('btn-random').onclick = randomize;
function randomize() {
  const f = FAMILIES[(Math.random() * FAMILIES.length) | 0].id;
  const r = defaultRecipe(f, (Math.random() * 1e6) | 0);
  const roles: Record<Family, MechRole[]> = {
    biped: ['combat', 'combat', 'scout', 'industrial', 'salvage'],
    exosuit: ['industrial', 'combat', 'salvage'],
    colossus: ['hauler', 'combat', 'industrial'],
    quadruped: ['hauler', 'combat', 'industrial', 'salvage'],
    hexapod: ['explorer', 'combat', 'hauler'],
    octopod: ['explorer', 'combat'],
  };
  r.role = roles[f][(Math.random() * roles[f].length) | 0];
  r.scale = 0.85 + Math.random() * 0.35;
  r.bulk = Math.random();
  const schemes = Object.keys(SCHEMES);
  r.scheme = schemes[(Math.random() * schemes.length) | 0];
  recipe = r;
  selected = null;
  rebuild(true);
}
$('btn-save').onclick = () => download(`${slug(result.mech.name)}.badmech.json`, strToU8(JSON.stringify(recipe, null, 2)), 'application/json');
$<HTMLInputElement>('file-load').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const r = JSON.parse(await f.text());
    if (r.format !== 'badmech-recipe') throw new Error('not a .badmech.json recipe');
    recipe = { ...defaultRecipe(r.family, r.seed), ...r };
    selected = null;
    rebuild(true);
    toast(`Loaded ${result.mech.name}`);
  } catch (err) {
    toast(`Couldn't load: ${(err as Error).message}`);
  }
  (e.target as HTMLInputElement).value = '';
};
const menu = $('export-menu');
$('btn-export').onclick = (e) => {
  e.stopPropagation();
  menu.classList.toggle('open');
};
document.addEventListener('click', () => menu.classList.remove('open'));
menu.addEventListener('click', (e) => {
  const kind = (e.target as HTMLElement).closest('button')?.dataset.export;
  if (!kind) return;
  menu.classList.remove('open');
  toast('Exporting…');
  setTimeout(() => doExport(kind), 30);
});

function doExport(kind: string) {
  const mech = result.mech;
  const base = slug(mech.name);
  calibrateGait(mech);
  if (kind === 'package') {
    const { files } = buildPackage(mech, recipe, result.fits, BRIDGE);
    download(`${base}_badmech.zip`, zipSync(files, { level: 6 }), 'application/zip');
  } else if (kind === 'glb') download(`${base}.glb`, exportGlb(mech, { lod: 0, recipe }), 'model/gltf-binary');
  else if (kind === 'rig') download(`${base}.rig.json`, strToU8(JSON.stringify(rigSidecar(mech, recipe, { limitFits: result.fits }), null, 1)), 'application/json');
  else if (kind === 'usda') download(`${base}.usda`, strToU8(exportUsda(mech)), 'text/plain');
  else if (kind === 'obj') {
    const { obj, mtl } = exportObj(mech, base);
    download(`${base}_obj.zip`, zipSync({ [`${base}.obj`]: strToU8(obj), [`${base}.mtl`]: strToU8(mtl) }), 'application/zip');
  }
  toast(kind === 'obj' ? 'OBJ exported. Reminder: OBJ is static, no rig.' : 'Exported ✓');
}

function download(name: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// viewport hud
$('pose-modes').addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).closest('button')?.dataset.mode as typeof mode | undefined;
  if (!m) return;
  setMode(m);
});
function setMode(m: typeof mode) {
  mode = m;
  document.querySelectorAll('#pose-modes button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === m));
  if (m === 'walk') {
    selBox.visible = false;
    startWalk();
  } else {
    stopWalk();
    if (view) {
      view.root.position.set(0, 0, 0);
      view.setPose(m === 'rest' ? manualPose : poseForFlex(clock));
    }
    frameTargetBack();
    updateSelBox();
  }
  renderInspector();
}
function frameTargetBack() {
  const s = result.mech.stats;
  const dz = controls.target.z;
  if (Math.abs(dz) > 0.01) {
    controls.target.z -= dz;
    camera.position.z -= dz;
  }
  controls.target.y = s.height * 0.45;
}
$('toggles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  const t = b?.dataset.t;
  if (!b || !t) return;
  if (t === 'lod') {
    lod = ((lod + 1) % 3) as 0 | 1 | 2;
    b.textContent = `LOD ${lod}`;
    b.classList.toggle('on', lod > 0);
    rebuild();
    return;
  }
  const k = t as keyof typeof toggles;
  toggles[k] = !toggles[k];
  b.classList.toggle('on', toggles[k]);
  if (k === 'joints' || k === 'collision') {
    clearOverlays();
    buildOverlays();
  } else applyVisibility();
});
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input, select, textarea')) return;
  if (e.key === 'r' || e.key === 'R') randomize();
  if (e.key === 'f' || e.key === 'F') frameCamera();
  if (e.key === 'w' || e.key === 'W') setMode(mode === 'walk' ? 'rest' : 'walk');
  if (e.key === 'Escape') select(null);
});

// ───────────────────────────────────────────────────────── share link ──
function writeHash() {
  try {
    history.replaceState(null, '', '#r=' + btoa(unescape(encodeURIComponent(JSON.stringify(recipe)))));
  } catch {
    /* ignore */
  }
}
function loadFromHash(): MechRecipe | null {
  try {
    const m = location.hash.match(/#r=(.+)/);
    if (!m) return null;
    const r = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    return r.format === 'badmech-recipe' ? { ...defaultRecipe(r.family, r.seed), ...r } : null;
  } catch {
    return null;
  }
}

let toastT = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => t.classList.remove('show'), 3200);
}

// ────────────────────────────────────────────────────────────── loop ──
let last = performance.now();
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  if (mode === 'flex' && view) view.setPose(poseForFlex(clock));
  if (mode === 'walk' && walker && walkScene) {
    walker.update(dt);
    const root = walker.obj.get(walker.rig.rootNode)!;
    const z = root.position.z;
    const dz = z - (controls.target.z ?? 0);
    controls.target.z += dz;
    camera.position.z += dz;
    sun.position.z += dz;
    sun.target.position.z = z;
    grid.position.z = Math.floor(z);
  } else {
    sun.target.position.set(0, 0, 0);
    grid.position.z = 0;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

resize();
rebuild(true);
requestAnimationFrame(loop);
// for tests / debugging from the console
Object.assign(window, { badmech: { get recipe() { return recipe; }, get result() { return result; }, setMode, rebuild, select } });
