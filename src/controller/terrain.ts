/**
 * Procedural test terrain for foot-placement IK: rolling hills, flat-topped steps and rocks,
 * all scaled to the mech (a 3 m exosuit and a 25 m colossus get proportionate obstacles).
 * The same object answers height/normal queries for the controller and builds the render mesh,
 * so what you see is exactly what the feet are standing on.
 */
import { Vector3 } from 'three';
import { Rng } from '../core/rng';
import type { Ground } from './walker';

export interface Obstacle {
  kind: 'step' | 'rock';
  x: number;
  z: number;
  /** half sizes of the footprint */
  hw: number;
  hd: number;
  rot: number;
  /** height above the terrain at its centre */
  h: number;
  /** absolute top height */
  top: number;
}

export interface TerrainOpts {
  /** characteristic size: mech height */
  size: number;
  /** obstacle scale: the mech's comfortable step height */
  step: number;
  seed?: number;
  /** 0 = flat, 1 = rough */
  roughness?: number;
}

export class Terrain implements Ground {
  readonly obstacles: Obstacle[] = [];
  readonly extent: number;
  private waves: { kx: number; kz: number; ph: number; a: number }[] = [];
  private flatR: number;

  constructor(readonly o: TerrainOpts) {
    const rng = new Rng(`terrain:${o.seed ?? 1}`);
    const L = o.size;
    const rough = o.roughness ?? 0.6;
    this.extent = L * 14;
    this.flatR = L * 0.9;
    // rolling hills: a few long, low waves (amplitude tied to the step height so it stays walkable)
    for (let i = 0; i < 5; i++) {
      const wl = L * rng.range(2.5, 7);
      const ang = rng.range(0, Math.PI * 2);
      this.waves.push({ kx: (Math.cos(ang) * 2 * Math.PI) / wl, kz: (Math.sin(ang) * 2 * Math.PI) / wl, ph: rng.range(0, Math.PI * 2), a: o.step * rough * rng.range(0.6, 1.4) });
    }
    // obstacles, kept out of the start area
    const n = Math.round(40 * rough + 8);
    for (let i = 0; i < n; i++) {
      const r = rng.range(this.flatR * 1.4, this.extent * 0.8);
      const a = rng.range(0, Math.PI * 2);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const step = rng.chance(0.45);
      const hw = step ? L * rng.range(0.25, 0.7) : L * rng.range(0.05, 0.14);
      const hd = step ? L * rng.range(0.25, 0.7) : hw * rng.range(0.6, 1.3);
      const h = o.step * rough * (step ? rng.range(0.4, 0.8) : rng.range(0.3, 0.7));
      this.obstacles.push({ kind: step ? 'step' : 'rock', x, z, hw, hd, rot: rng.range(0, Math.PI), h, top: this.base(x, z) + h });
    }
  }

  /** Smooth ground without obstacles. Flat (y = 0) around the start so the mech spawns cleanly. */
  base(x: number, z: number): number {
    let h = 0;
    for (const w of this.waves) h += w.a * Math.sin(w.kx * x + w.kz * z + w.ph);
    const d = Math.hypot(x, z);
    const t = Math.min(1, Math.max(0, (d - this.flatR) / this.flatR));
    return h * t * t * (3 - 2 * t);
  }

  private inside(o: Obstacle, x: number, z: number): boolean {
    const c = Math.cos(-o.rot);
    const s = Math.sin(-o.rot);
    const dx = x - o.x;
    const dz = z - o.z;
    return Math.abs(dx * c - dz * s) <= o.hw && Math.abs(dx * s + dz * c) <= o.hd;
  }

  height(x: number, z: number): number {
    let h = this.base(x, z);
    for (const o of this.obstacles) if (this.inside(o, x, z)) h = Math.max(h, o.top);
    return h;
  }

  normal(x: number, z: number): Vector3 {
    for (const o of this.obstacles) if (this.inside(o, x, z) && o.top >= this.base(x, z)) return new Vector3(0, 1, 0);
    const e = 0.05;
    return new Vector3(-(this.base(x + e, z) - this.base(x - e, z)), 2 * e, -(this.base(x, z + e) - this.base(x, z - e))).normalize();
  }
}
