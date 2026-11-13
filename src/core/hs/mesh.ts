/**
 * Triangle-soup builder with auto-smooth normals: faces meeting at less than `angle` are shaded
 * smooth, sharper edges stay crisp (the "weighted normals" hard-surface look), then the result is
 * welded into an indexed mesh.
 */
import type { MeshData } from '../geometry';

export type V3 = [number, number, number];

export class TriSoup {
  pos: number[] = [];

  tri(a: V3, b: V3, c: V3) {
    this.pos.push(...a, ...b, ...c);
  }
  quad(a: V3, b: V3, c: V3, d: V3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** Build indexed mesh with auto-smoothed normals and box-projected UVs. */
  build(angleDeg = 35, transform?: (p: V3) => V3, ntransform?: (n: V3) => V3): MeshData {
    const P = this.pos;
    const triCount = P.length / 9;
    const fn: V3[] = [];
    const fa: number[] = [];
    const keep: boolean[] = [];
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      const ux = P[o + 3] - P[o];
      const uy = P[o + 4] - P[o + 1];
      const uz = P[o + 5] - P[o + 2];
      const vx = P[o + 6] - P[o];
      const vy = P[o + 7] - P[o + 1];
      const vz = P[o + 8] - P[o + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      keep.push(l > 1e-10);
      fa.push(l / 2);
      fn.push(l > 0 ? [nx / l, ny / l, nz / l] : [0, 1, 0]);
    }
    // corners grouped by quantised position
    const key = (i: number) => `${Math.round(P[i] * 1e5)},${Math.round(P[i + 1] * 1e5)},${Math.round(P[i + 2] * 1e5)}`;
    const groups = new Map<string, number[]>();
    for (let t = 0; t < triCount; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const kk = key(t * 9 + k * 3);
        let g = groups.get(kk);
        if (!g) groups.set(kk, (g = []));
        g.push(t * 3 + k);
      }
    }
    const cosA = Math.cos((angleDeg * Math.PI) / 180);
    const cornerN: V3[] = new Array(triCount * 3);
    for (const g of groups.values()) {
      for (const c of g) {
        const t = (c / 3) | 0;
        const n0 = fn[t];
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const d of g) {
          const u = (d / 3) | 0;
          const n1 = fn[u];
          if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] >= cosA) {
            const w = fa[u];
            sx += n1[0] * w;
            sy += n1[1] * w;
            sz += n1[2] * w;
          }
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        cornerN[c] = [sx / l, sy / l, sz / l];
      }
    }
    // weld identical (pos, normal) corners; UVs projected from the face normal
    const out: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
    const weld = new Map<string, number>();
    for (let t = 0; t < triCount; t++) {
      if (!keep[t]) continue;
      const f = fn[t];
      const ax = Math.abs(f[0]);
      const ay = Math.abs(f[1]);
      const az = Math.abs(f[2]);
      const dom = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
      for (let k = 0; k < 3; k++) {
        const i = t * 9 + k * 3;
        let p: V3 = [P[i], P[i + 1], P[i + 2]];
        let n = cornerN[t * 3 + k];
        const uv: [number, number] = dom === 0 ? [p[2] * Math.sign(f[0] || 1), -p[1]] : dom === 1 ? [p[0], p[2] * Math.sign(f[1] || 1)] : [-p[0] * Math.sign(f[2] || 1), -p[1]];
        if (transform) p = transform(p);
        if (ntransform) n = ntransform(n);
        const wk = `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}|${Math.round(n[0] * 1e3)},${Math.round(n[1] * 1e3)},${Math.round(n[2] * 1e3)}|${dom}`;
        let idx = weld.get(wk);
        if (idx === undefined) {
          idx = out.positions.length / 3;
          weld.set(wk, idx);
          out.positions.push(p[0], p[1], p[2]);
          out.normals.push(n[0], n[1], n[2]);
          out.uvs.push(uv[0], uv[1]);
        }
        out.indices.push(idx);
      }
    }
    return out;
  }
}
