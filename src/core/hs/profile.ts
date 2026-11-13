/**
 * 2D profiles for hard-surface modelling. A profile is a closed CCW polygon in the XY plane.
 * Everything interesting (chamfers, fillets, armour curvature) is a corner treatment or an arc,
 * and every builder takes a fixed segment count so profiles built with the same builder always
 * have the same vertex count — which is what makes lofting between different shapes possible.
 */
export type P2 = [number, number];
export type Profile = P2[];

/** Corner-treat a polygon: r > 0 rounds (segs ≥ 2) or chamfers (segs = 1) each corner. */
export function treatCorners(poly: Profile, radii: number | number[], segs: number): Profile {
  const n = poly.length;
  const out: Profile = [];
  for (let i = 0; i < n; i++) {
    const r = Array.isArray(radii) ? radii[i] ?? 0 : radii;
    const p = poly[i];
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    if (r <= 1e-6) {
      // keep vertex count stable: emit segs+1 coincident points
      for (let k = 0; k <= segs; k++) out.push([p[0], p[1]]);
      continue;
    }
    const ua = norm([a[0] - p[0], a[1] - p[1]]);
    const ub = norm([b[0] - p[0], b[1] - p[1]]);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const cos = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]));
    const theta = Math.acos(cos);
    let d = r / Math.tan(theta / 2);
    d = Math.min(d, la * 0.49, lb * 0.49);
    const s: P2 = [p[0] + ua[0] * d, p[1] + ua[1] * d];
    const e: P2 = [p[0] + ub[0] * d, p[1] + ub[1] * d];
    if (segs <= 1) {
      out.push(s, e);
      continue;
    }
    // circular arc tangent at s and e
    const rr = d * Math.tan(theta / 2);
    const bis = norm([ua[0] + ub[0], ua[1] + ub[1]]);
    const cd = Math.hypot(d, rr);
    const c: P2 = [p[0] + bis[0] * cd, p[1] + bis[1] * cd];
    let a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
    let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= segs; k++) {
      const t = a0 + (da * k) / segs;
      out.push([c[0] + Math.cos(t) * rr, c[1] + Math.sin(t) * rr]);
    }
    void a1;
  }
  return out;
}

function norm(v: P2): P2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

export interface RectOpts {
  /** corner radius/chamfer: one value or [BR, TR, TL, BL] */
  r?: number | number[];
  segs?: number;
  /** top width as a fraction of bottom width (trapezoid) */
  topScale?: number;
  /** shift top edge sideways */
  topShift?: number;
  /** bulge of top / bottom / left / right edges (arc sagitta, metres) */
  bulge?: [number, number, number, number];
  /** points per edge for bulged edges */
  edgeSegs?: number;
}

/**
 * The workhorse: a (possibly trapezoidal, possibly bulged) rectangle with treated corners.
 * Vertex count depends only on segs/edgeSegs, never on dimensions.
 */
export function rect(w: number, h: number, o: RectOpts = {}): Profile {
  const ts = o.topScale ?? 1;
  const sh = o.topShift ?? 0;
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const corners: Profile = [
    [x1, y0],
    [x1 * ts + sh, y1],
    [x0 * ts + sh, y1],
    [x0, y0],
  ];
  const es = o.edgeSegs ?? 0;
  const bul = o.bulge ?? [0, 0, 0, 0];
  // edges in order: right (BR→TR), top (TR→TL), left (TL→BL), bottom (BL→BR)
  const bulgeOf = [bul[3], bul[0], bul[2], bul[1]];
  let poly: Profile;
  let radii: number[] | number = o.r ?? 0;
  if (es > 0) {
    poly = [];
    const rr: number[] = [];
    const cr = Array.isArray(o.r) ? o.r : [o.r ?? 0, o.r ?? 0, o.r ?? 0, o.r ?? 0];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const nx = b[1] - a[1];
      const ny = -(b[0] - a[0]);
      const nl = Math.hypot(nx, ny) || 1;
      poly.push(a);
      rr.push(cr[i]);
      for (let k = 1; k < es; k++) {
        const t = k / es;
        const sag = bulgeOf[i] * 4 * t * (1 - t);
        poly.push([a[0] + (b[0] - a[0]) * t + (nx / nl) * sag, a[1] + (b[1] - a[1]) * t + (ny / nl) * sag]);
        rr.push(0);
      }
    }
    radii = rr;
    // interior edge points get "0-radius" treatment, which duplicates them – fine for lofting,
    // and the mesh welder removes the zero-area faces.
  } else poly = corners;
  return treatCorners(poly, radii, o.segs ?? 1);
}

/** Regular n-gon (hex nuts, octagonal housings). */
export function ngon(r: number, n: number, rot = 0): Profile {
  const out: Profile = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Circle as n-gon, CCW. */
export const circle = (r: number, n: number) => ngon(r, n);

/** Miter offset (positive = outward). Robust for the convex-ish profiles we use. */
export function offset(poly: Profile, d: number): Profile {
  const n = poly.length;
  const out: Profile = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    // skip coincident neighbours when finding edge directions
    let ai = (i - 1 + n) % n;
    let guard = 0;
    while (dist(poly[ai], p) < 1e-7 && guard++ < n) ai = (ai - 1 + n) % n;
    let bi = (i + 1) % n;
    guard = 0;
    while (dist(poly[bi], p) < 1e-7 && guard++ < n) bi = (bi + 1) % n;
    const a = poly[ai];
    const b = poly[bi];
    const e1 = norm([p[0] - a[0], p[1] - a[1]]);
    const e2 = norm([b[0] - p[0], b[1] - p[1]]);
    // outward normals for CCW: (dy, -dx)
    const n1: P2 = [e1[1], -e1[0]];
    const n2: P2 = [e2[1], -e2[0]];
    const m = norm([n1[0] + n2[0], n1[1] + n2[1]]);
    const c = Math.max(0.3, m[0] * n1[0] + m[1] * n1[1]);
    out.push([p[0] + (m[0] * d) / c, p[1] + (m[1] * d) / c]);
  }
  return out;
}

function dist(a: P2, b: P2) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function scaleP(poly: Profile, sx: number, sy = sx, ox = 0, oy = 0): Profile {
  return poly.map(([x, y]) => [x * sx + ox, y * sy + oy]);
}

export function area(poly: Profile): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon (handles concave). Returns index triples. */
export function triangulate(poly: Profile): number[] {
  const idx: number[] = [];
  // drop coincident consecutive points for robustness
  const keep: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const prev = keep.length ? poly[keep[keep.length - 1]] : poly[poly.length - 1];
    if (!keep.length || dist(prev, poly[i]) > 1e-7) keep.push(i);
  }
  if (keep.length > 2 && dist(poly[keep[0]], poly[keep[keep.length - 1]]) < 1e-7) keep.pop();
  const V = keep.slice();
  if (area(poly) < 0) V.reverse();
  let guard = 0;
  while (V.length > 3 && guard++ < 5000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const a = poly[V[(i - 1 + V.length) % V.length]];
      const b = poly[V[i]];
      const c = poly[V[(i + 1) % V.length]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-12) continue;
      let inside = false;
      for (const j of V) {
        const p = poly[j];
        if (p === a || p === b || p === c) continue;
        if (inTri(p, a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      idx.push(V[(i - 1 + V.length) % V.length], V[i], V[(i + 1) % V.length]);
      V.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate leftovers: fan the rest
  }
  for (let i = 1; i < V.length - 1; i++) idx.push(V[0], V[i], V[i + 1]);
  return idx;
}

function inTri(p: P2, a: P2, b: P2, c: P2) {
  const s = (q: P2, r: P2) => (r[0] - q[0]) * (p[1] - q[1]) - (r[1] - q[1]) * (p[0] - q[0]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  return d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12;
}
