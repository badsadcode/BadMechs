/**
 * Self-contained glTF 2.0 / GLB writer. No three.js scene graph in between, so what's in the
 * Mech model is exactly what lands in the file: one node per mech node (pivots = node origins),
 * per-material primitives, PBR materials, skinned flex hoses, joint metadata in node extras and
 * the full rig sidecar in scene extras.
 */
import { Matrix4, Vector3 } from 'three';
import { buildNodeMeshes, LODS, MeshData, tubeAlong } from '../core/geometry';
import { worldMatrices } from '../core/kinematics';
import type { MaterialId, Mech } from '../core/model';
import { MATERIAL_NAMES } from '../core/palette';
import { hosePoints } from '../render/threeMech';
import { collisionBoxes, rigSidecar } from './rig';
import type { MechRecipe } from '../core/recipe';

export interface GltfOptions {
  lod?: 0 | 1 | 2;
  interiors?: boolean;
  cables?: boolean;
  /** export only collision boxes (for a *_collision.glb) */
  collisionOnly?: boolean;
  recipe?: MechRecipe;
  /** embed the rig sidecar in scene.extras (default true) */
  embedRig?: boolean;
}

interface Acc {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

class BufferBuilder {
  chunks: Uint8Array[] = [];
  length = 0;
  views: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  accessors: Acc[] = [];

  private push(bytes: Uint8Array, target?: number) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    this.views.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.chunks.push(bytes);
    this.length += bytes.byteLength;
    return this.views.length - 1;
  }

  f32(data: number[], type: 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', target?: number, minmax = false): number {
    const arr = new Float32Array(data);
    const bv = this.push(new Uint8Array(arr.buffer), target);
    const n = { VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc: Acc = { bufferView: bv, componentType: 5126, count: data.length / n, type };
    if (minmax) {
      const mn = new Array(n).fill(Infinity);
      const mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        mn[i % n] = Math.min(mn[i % n], arr[i]);
        mx[i % n] = Math.max(mx[i % n], arr[i]);
      }
      acc.min = mn;
      acc.max = mx;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  indices(data: number[], vertexCount: number): number {
    const big = vertexCount > 65535;
    const arr = big ? new Uint32Array(data) : new Uint16Array(data);
    const bv = this.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), 34963);
    this.accessors.push({ bufferView: bv, componentType: big ? 5125 : 5123, count: data.length, type: 'SCALAR' });
    return this.accessors.length - 1;
  }

  u16(data: number[], type: 'VEC4', target?: number): number {
    const arr = new Uint16Array(data);
    const bv = this.push(new Uint8Array(arr.buffer), target);
    this.accessors.push({ bufferView: bv, componentType: 5123, count: data.length / 4, type });
    return this.accessors.length - 1;
  }

  concat(): Uint8Array {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}

const ARRAY_BUFFER = 34962;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function buildGltf(mech: Mech, opts: GltfOptions = {}): { json: any; bin: Uint8Array } {
  const lod = opts.lod ?? 0;
  const interiors = opts.interiors ?? lod < 2;
  const withCables = opts.cables ?? !opts.collisionOnly;
  const bb = new BufferBuilder();
  const json: any = {
    asset: { version: '2.0', generator: 'BadMech glTF writer' },
    scene: 0,
    scenes: [{ name: mech.name, nodes: [0] }],
    nodes: [],
    meshes: [],
    materials: [],
  };

  // materials (stable order so indices match across LODs)
  const matIndex = new Map<MaterialId, number>();
  for (const [id, e] of Object.entries(mech.palette) as [MaterialId, (typeof mech.palette)[MaterialId]][]) {
    const m: any = {
      name: MATERIAL_NAMES[id],
      pbrMetallicRoughness: { baseColorFactor: [...e.color, e.alpha ?? 1], metallicFactor: e.metallic, roughnessFactor: e.roughness },
    };
    if (e.alpha !== undefined) {
      m.alphaMode = 'BLEND';
      m.doubleSided = true;
    }
    if (e.emissive) m.emissiveFactor = e.emissive.map((x) => Math.min(1, x));
    matIndex.set(id, json.materials.length);
    json.materials.push(m);
  }
  const colMat = json.materials.length;
  json.materials.push({ name: 'BM_Collision', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.9, 0.3, 0.35], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'BLEND', doubleSided: true });

  const nodeIndex = new Map<string, number>();
  const isInterior = new Set<string>();
  for (const n of mech.nodes) {
    if (n.component === 'interior' || (n.parent && isInterior.has(n.parent))) isInterior.add(n.name);
  }
  const boxes = opts.collisionOnly ? collisionBoxes(mech) : [];

  for (const n of mech.nodes) {
    const gn: any = { name: n.name, children: [] };
    if (n.position.some((x) => x !== 0)) gn.translation = n.position;
    if (!(n.quaternion[0] === 0 && n.quaternion[1] === 0 && n.quaternion[2] === 0 && n.quaternion[3] === 1)) gn.rotation = n.quaternion;
    const bm: any = { role: n.role, system: n.system };
    if (n.component) bm.component = n.component;
    if (n.tags.length) bm.tags = n.tags;
    if (n.joint) bm.joint = { ...n.joint, continuous: n.tags.includes('continuous') };
    gn.extras = { badmech: bm };
    const idx = json.nodes.length;
    json.nodes.push(gn);
    nodeIndex.set(n.name, idx);
    if (n.parent) json.nodes[nodeIndex.get(n.parent)!].children.push(idx);

    if (opts.collisionOnly) continue;
    if (!interiors && isInterior.has(n.name)) continue;
    const meshes = buildNodeMeshes(n, LODS[lod]);
    const prims: any[] = [];
    for (const [mat, d] of meshes) {
      if (!d.indices.length) continue;
      prims.push(primitive(bb, d, matIndex.get(mat)!));
    }
    if (prims.length) {
      gn.mesh = json.meshes.length;
      json.meshes.push({ name: `${n.name}_mesh`, primitives: prims });
    }
  }

  if (opts.collisionOnly) {
    for (const [i, b] of boxes.entries()) {
      const d = boxMesh(b.halfExtents);
      const mi = json.meshes.length;
      json.meshes.push({ name: `COL_${b.body}_${i}`, primitives: [primitive(bb, d, colMat)] });
      const ni = json.nodes.length;
      json.nodes.push({ name: `COL_${b.body}_${i}`, mesh: mi, translation: b.center, rotation: b.rotation, extras: { badmech: { role: 'collision', shape: 'box', halfExtents: b.halfExtents, body: b.body } } });
      json.nodes[nodeIndex.get(b.body)!].children.push(ni);
    }
  }

  // skinned flex hoses
  if (withCables && mech.cables.length) {
    const rest = worldMatrices(mech, {});
    json.skins = [];
    for (const c of mech.cables) {
      const wa = rest.get(c.fromNode)!;
      const wb = rest.get(c.toNode)!;
      const pa = new Vector3(...c.fromOffset).applyMatrix4(wa);
      const pb = new Vector3(...c.toOffset).applyMatrix4(wb);
      const pts = hosePoints(pa, pb, c.slack, 10);
      const { mesh, ringT } = tubeAlong(pts, c.radius, lod === 0 ? 8 : 5);
      const ring = mesh.positions.length / 3 / ringT.length;
      const joints: number[] = [];
      const weights: number[] = [];
      for (const t of ringT) {
        const s = t * t * (3 - 2 * t);
        for (let k = 0; k < ring; k++) {
          if (s <= 0) joints.push(0, 0, 0, 0), weights.push(1, 0, 0, 0);
          else if (s >= 1) joints.push(1, 0, 0, 0), weights.push(1, 0, 0, 0);
          else joints.push(0, 1, 0, 0), weights.push(1 - s, s, 0, 0);
        }
      }
      const ibm = [...new Matrix4().copy(wa).invert().elements, ...new Matrix4().copy(wb).invert().elements];
      const skin = { name: `${c.name}_skin`, joints: [nodeIndex.get(c.fromNode)!, nodeIndex.get(c.toNode)!], inverseBindMatrices: bb.f32(ibm, 'MAT4') };
      json.skins.push(skin);
      const prim = primitive(bb, mesh, matIndex.get('rubber')!);
      prim.attributes.JOINTS_0 = bb.u16(joints, 'VEC4', ARRAY_BUFFER);
      prim.attributes.WEIGHTS_0 = bb.f32(weights, 'VEC4', ARRAY_BUFFER);
      const mi = json.meshes.length;
      json.meshes.push({ name: c.meshNode, primitives: [prim] });
      const ni = json.nodes.length;
      json.nodes.push({ name: c.meshNode, mesh: mi, skin: json.skins.length - 1, extras: { badmech: { role: 'skinned', cable: c.name } } });
      // skinned mesh nodes live at scene root: their own transform is ignored per spec
      json.scenes[0].nodes.push(ni);
    }
  }

  for (const n of json.nodes) if (n.children && !n.children.length) delete n.children;
  if (!json.meshes.length) delete json.meshes;
  if (opts.embedRig ?? true) json.scenes[0].extras = { badmech: rigSidecar(mech, opts.recipe) };
  json.extras = { badmech: { schema: 'badmech-rig/1', lod, note: 'Rig metadata lives in scenes[0].extras.badmech and in the .rig.json sidecar' } };

  const bin = bb.concat();
  json.buffers = [{ byteLength: bin.byteLength }];
  json.bufferViews = bb.views;
  json.accessors = bb.accessors;
  return { json, bin };
}

function primitive(bb: BufferBuilder, d: MeshData, material: number): any {
  const n = d.positions.length / 3;
  return {
    attributes: {
      POSITION: bb.f32(d.positions, 'VEC3', ARRAY_BUFFER, true),
      NORMAL: bb.f32(d.normals, 'VEC3', ARRAY_BUFFER),
      TEXCOORD_0: bb.f32(d.uvs, 'VEC2', ARRAY_BUFFER),
    },
    indices: bb.indices(d.indices, n),
    material,
    mode: 4,
  };
}

function boxMesh(h: [number, number, number]): MeshData {
  const m: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
  const faces: [number[], number[]][] = [
    [[1, 0, 0], [0, 1, 2]],
    [[-1, 0, 0], [0, 1, 2]],
    [[0, 1, 0], [1, 2, 0]],
    [[0, -1, 0], [1, 2, 0]],
    [[0, 0, 1], [2, 0, 1]],
    [[0, 0, -1], [2, 0, 1]],
  ];
  for (const [nrm, [a, b, c]] of faces) {
    const s = nrm[a] || 1;
    const base = m.positions.length / 3;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [u, v] of corners) {
      const p = [0, 0, 0];
      p[a] = s * h[a];
      p[b] = u * h[b];
      p[c] = v * h[c];
      m.positions.push(...p);
      m.normals.push(...nrm);
      m.uvs.push((u + 1) / 2, (v + 1) / 2);
    }
    if (s > 0) m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else m.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return m;
}

export function toGlb(json: any, bin: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const p = new Uint8Array(jsonBytes.length + jpad);
    p.set(jsonBytes);
    p.fill(0x20, jsonBytes.length);
    jsonBytes = p;
  }
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const o = 20 + jsonBytes.length;
  dv.setUint32(o, bin.length, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(bin, o + 8);
  return out;
}

export function exportGlb(mech: Mech, opts: GltfOptions = {}): Uint8Array {
  const { json, bin } = buildGltf(mech, opts);
  return toGlb(json, bin);
}
