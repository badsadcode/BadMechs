import { Matrix3, Matrix4, Vector3 } from 'three';
import type { MaterialId, MechNode, Prim } from './model';
import { primBaseMatrix } from './builder';
import { buildShape } from './hs/shapes';

/**
 * Plain triangle soup per material, engine-agnostic. Hard-surface flat shading on boxes,
 * smooth sides on cylinders. UVs are world-scale box projections (1 UV unit = 1 metre),
 * so tiling trim sheets / grunge textures line up across parts.
 */
export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export type NodeMeshes = Map<MaterialId, MeshData>;

export interface LodSpec {
  /** drop prims with detail > maxDetail */
  maxDetail: 0 | 1 | 2;
  /** multiply radial segments */
  segScale: number;
  /** min radial segments */
  minSeg: number;
  /** hard-surface shape LOD index */
  shape: 0 | 1 | 2;
}

export const LODS: LodSpec[] = [
  { maxDetail: 2, segScale: 1, minSeg: 6, shape: 0 },
  { maxDetail: 1, segScale: 0.5, minSeg: 6, shape: 1 },
  { maxDetail: 0, segScale: 0.34, minSeg: 5, shape: 2 },
];

function emptyMesh(): MeshData {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

export function buildNodeMeshes(node: MechNode, lod: LodSpec = LODS[0]): NodeMeshes {
  const out: NodeMeshes = new Map();
  for (const p of node.prims) {
    if (p.detail > lod.maxDetail) continue;
    let m = out.get(p.material);
    if (!m) out.set(p.material, (m = emptyMesh()));
    appendPrim(m, p, lod);
  }
  return out;
}

export function appendPrim(m: MeshData, p: Prim, lod: LodSpec = LODS[0]) {
  const mat = primBaseMatrix(p);
  const nmat = new Matrix3().getNormalMatrix(mat);
  if (p.kind === 'shape' && p.shape) {
    const d = buildShape(p.shape, lod.shape);
    const base = m.positions.length / 3;
    const v = new Vector3();
    for (let i = 0; i < d.positions.length; i += 3) {
      v.set(d.positions[i], d.positions[i + 1], d.positions[i + 2]).applyMatrix4(mat);
      m.positions.push(v.x, v.y, v.z);
      v.set(d.normals[i], d.normals[i + 1], d.normals[i + 2]).applyMatrix3(nmat).normalize();
      m.normals.push(v.x, v.y, v.z);
    }
    m.uvs.push(...d.uvs);
    for (const i of d.indices) m.indices.push(base + i);
    return;
  }
  const segs = Math.max(lod.minSeg, Math.round((p.segments ?? 12) * lod.segScale));
  switch (p.kind) {
    case 'box':
      quadsToMesh(m, boxQuads(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2), mat, nmat);
      break;
    case 'chamfer':
      quadsToMesh(m, chamferQuads(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2, p.extra?.[0] ?? 0.05), mat, nmat);
      break;
    case 'taper':
      quadsToMesh(m, taperQuads(p), mat, nmat);
      break;
    case 'cyl':
      cylinder(m, p.size[0], p.size[2], p.size[1], segs, mat, nmat);
      break;
    case 'sphere':
      sphere(m, p.size[0], segs, mat, nmat);
      break;
  }
}

type Quad = Vector3[]; // 3 or 4 coplanar points, CCW seen from outside

function boxQuads(x: number, y: number, z: number): Quad[] {
  const v = (a: number, b: number, c: number) => new Vector3(a * x, b * y, c * z);
  return [
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)], // +x
    [v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), v(-1, -1, -1)], // -x
    [v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)], // +y
    [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)], // -y
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)], // +z
    [v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)], // -z
  ];
}

/** Octagonal profile in XY, extruded along Z. */
function chamferQuads(x: number, y: number, z: number, c: number): Quad[] {
  c = Math.min(c, x * 0.9, y * 0.9);
  const prof: [number, number][] = [
    [x, -y + c],
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
    [-x + c, -y],
    [x - c, -y],
  ];
  const q: Quad[] = [];
  for (let i = 0; i < 8; i++) {
    const [ax, ay] = prof[i];
    const [bx, by] = prof[(i + 1) % 8];
    q.push([new Vector3(ax, ay, z), new Vector3(ax, ay, -z), new Vector3(bx, by, -z), new Vector3(bx, by, z)]);
  }
  // caps as fans of triangles
  const front = prof.map(([a, b]) => new Vector3(a, b, z));
  const back = prof.map(([a, b]) => new Vector3(a, b, -z)).reverse();
  for (let i = 1; i < 7; i++) {
    q.push([front[0], front[i], front[i + 1]]);
    q.push([back[0], back[i], back[i + 1]]);
  }
  return q;
}

function taperQuads(p: Prim): Quad[] {
  const [w, h, d] = p.size;
  const [sx, sz, ox, oz] = p.extra!;
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const b = (a: number, c: number) => new Vector3(a * x, -y, c * z);
  const t = (a: number, c: number) => new Vector3(a * x * sx + ox, y, c * z * sz + oz);
  return [
    [b(1, -1), t(1, -1), t(1, 1), b(1, 1)],
    [b(-1, 1), t(-1, 1), t(-1, -1), b(-1, -1)],
    [t(-1, 1), t(1, 1), t(1, -1), t(-1, -1)],
    [b(-1, -1), b(1, -1), b(1, 1), b(-1, 1)],
    [b(-1, 1), b(1, 1), t(1, 1), t(-1, 1)],
    [b(1, -1), b(-1, -1), t(-1, -1), t(1, -1)],
  ];
}

const _n = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();

function quadsToMesh(m: MeshData, quads: Quad[], mat: Matrix4, nmat: Matrix3) {
  for (const q of quads) {
    const pts = q.map((p) => p.clone().applyMatrix4(mat));
    _e1.subVectors(pts[1], pts[0]);
    _e2.subVectors(pts[2], pts[0]);
    _n.crossVectors(_e1, _e2);
    if (_n.lengthSq() < 1e-14 && pts.length === 4) {
      _e2.subVectors(pts[3], pts[0]);
      _n.crossVectors(_e1, _e2);
    }
    if (_n.lengthSq() < 1e-14) continue; // degenerate face
    _n.normalize();
    // box-projected UVs on the dominant axis of the (node-space) normal
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    const base = m.positions.length / 3;
    for (const p of pts) {
      m.positions.push(p.x, p.y, p.z);
      m.normals.push(_n.x, _n.y, _n.z);
      if (ax >= ay && ax >= az) m.uvs.push(p.z * Math.sign(_n.x || 1), -p.y);
      else if (ay >= az) m.uvs.push(p.x, p.z * Math.sign(_n.y || 1));
      else m.uvs.push(-p.x * Math.sign(_n.z || 1), -p.y);
    }
    for (let i = 1; i < pts.length - 1; i++) m.indices.push(base, base + i, base + i + 1);
  }
  void nmat;
}

function cylinder(m: MeshData, r0: number, r1: number, len: number, segs: number, mat: Matrix4, nmat: Matrix3) {
  const h = len / 2;
  const base = m.positions.length / 3;
  const slope = (r0 - r1) / len;
  const circ = 2 * Math.PI * Math.max(r0, r1);
  // side
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const n = new Vector3(c, slope, s).normalize().applyMatrix3(nmat).normalize();
    for (const [r, y] of [
      [r0, -h],
      [r1, h],
    ]) {
      const p = new Vector3(c * r, y, s * r).applyMatrix4(mat);
      m.positions.push(p.x, p.y, p.z);
      m.normals.push(n.x, n.y, n.z);
      m.uvs.push((i / segs) * circ, -(y + h));
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    m.indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  // caps
  for (const [r, y, dir] of [
    [r0, -h, -1],
    [r1, h, 1],
  ] as const) {
    if (r < 1e-5) continue;
    const n = new Vector3(0, dir, 0).applyMatrix3(nmat).normalize();
    const cb = m.positions.length / 3;
    const cp = new Vector3(0, y, 0).applyMatrix4(mat);
    m.positions.push(cp.x, cp.y, cp.z);
    m.normals.push(n.x, n.y, n.z);
    m.uvs.push(0, 0);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const p = new Vector3(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(mat);
      m.positions.push(p.x, p.y, p.z);
      m.normals.push(n.x, n.y, n.z);
      m.uvs.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = 0; i < segs; i++) {
      if (dir > 0) m.indices.push(cb, cb + 2 + i, cb + 1 + i);
      else m.indices.push(cb, cb + 1 + i, cb + 2 + i);
    }
  }
}

function sphere(m: MeshData, r: number, segs: number, mat: Matrix4, nmat: Matrix3) {
  const rings = Math.max(3, Math.round(segs / 2));
  const base = m.positions.length / 3;
  for (let j = 0; j <= rings; j++) {
    const v = j / rings;
    const phi = v * Math.PI;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const th = u * Math.PI * 2;
      const n = new Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
      const p = n.clone().multiplyScalar(r).applyMatrix4(mat);
      const nn = n.applyMatrix3(nmat).normalize();
      m.positions.push(p.x, p.y, p.z);
      m.normals.push(nn.x, nn.y, nn.z);
      m.uvs.push(u * 2 * Math.PI * r, v * Math.PI * r);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
      const a = base + j * (segs + 1) + i;
      const b = a + segs + 1;
      m.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
}

export function meshTriangleCount(m: NodeMeshes) {
  let t = 0;
  for (const d of m.values()) t += d.indices.length / 3;
  return t;
}

/** Flex-hose tube following a polyline of world points (used for skinned cables). */
export function tubeAlong(points: Vector3[], radius: number, segs = 8): { mesh: MeshData; ringT: number[] } {
  const m = emptyMesh();
  const ringT: number[] = [];
  const up = new Vector3(0, 1, 0);
  let prevSide: Vector3 | null = null;
  for (let i = 0; i < points.length; i++) {
    const t = new Vector3().subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    let side: Vector3 = prevSide ? prevSide.clone().sub(t.clone().multiplyScalar(prevSide.dot(t))).normalize() : new Vector3().crossVectors(t, up);
    if (side.lengthSq() < 1e-6) side = new Vector3().crossVectors(t, new Vector3(1, 0, 0)).normalize();
    side.normalize();
    prevSide = side;
    const bin = new Vector3().crossVectors(t, side).normalize();
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).add(bin.clone().multiplyScalar(Math.sin(a)));
      const p = points[i].clone().add(n.clone().multiplyScalar(radius));
      m.positions.push(p.x, p.y, p.z);
      m.normals.push(n.x, n.y, n.z);
      m.uvs.push(k / segs, i / (points.length - 1));
    }
    ringT.push(i / (points.length - 1));
  }
  for (let i = 0; i < points.length - 1; i++)
    for (let k = 0; k < segs; k++) {
      const a = i * (segs + 1) + k;
      const b = a + segs + 1;
      m.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  return { mesh: m, ringT };
}
