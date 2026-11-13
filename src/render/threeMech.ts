import * as THREE from 'three';
import { buildNodeMeshes, LODS, tubeAlong } from '../core/geometry';
import { applyActuatorAim, AXIS_VEC, clampAngle, worldPos } from '../core/kinematics';
import type { MaterialId, Mech, MechNode, Pose } from '../core/model';
import { MATERIAL_NAMES } from '../core/palette';

export interface MechView {
  root: THREE.Group;
  objects: Map<string, THREE.Object3D>;
  restQuat: Map<string, THREE.Quaternion>;
  materials: Map<MaterialId, THREE.MeshStandardMaterial>;
  cables: { cable: Mech['cables'][number]; mesh: THREE.Mesh }[];
  setPose(pose: Pose): void;
  dispose(): void;
}

export function makeMaterials(mech: Mech) {
  const mats = new Map<MaterialId, THREE.MeshStandardMaterial>();
  for (const [id, e] of Object.entries(mech.palette) as [MaterialId, (typeof mech.palette)[MaterialId]][]) {
    const m = new THREE.MeshStandardMaterial({
      name: MATERIAL_NAMES[id],
      color: new THREE.Color().setRGB(e.color[0], e.color[1], e.color[2], THREE.LinearSRGBColorSpace),
      metalness: e.metallic,
      roughness: e.roughness,
      transparent: e.alpha !== undefined,
      opacity: e.alpha ?? 1,
      side: id === 'glass' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (e.emissive) {
      m.emissive.setRGB(e.emissive[0], e.emissive[1], e.emissive[2], THREE.LinearSRGBColorSpace);
      m.emissiveIntensity = id === 'emissive' ? 2.2 : 1;
    }
    mats.set(id, m);
  }
  return mats;
}

export function buildMechView(mech: Mech, lod = 0): MechView {
  const materials = makeMaterials(mech);
  const objects = new Map<string, THREE.Object3D>();
  const restQuat = new Map<string, THREE.Quaternion>();
  const root = new THREE.Group();
  root.name = mech.name;
  for (const n of mech.nodes) {
    const o = new THREE.Group();
    o.name = n.name;
    o.position.set(...n.position);
    o.quaternion.set(...n.quaternion);
    restQuat.set(n.name, o.quaternion.clone());
    o.userData.node = n;
    const meshes = buildNodeMeshes(n, LODS[lod]);
    for (const [mat, data] of meshes) {
      if (!data.indices.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      g.setIndex(data.indices);
      const mesh = new THREE.Mesh(g, materials.get(mat)!);
      mesh.castShadow = mat !== 'glass';
      mesh.receiveShadow = true;
      mesh.userData.pickNode = n.name;
      o.add(mesh);
    }
    objects.set(n.name, o);
    if (n.parent) objects.get(n.parent)!.add(o);
    else root.add(o);
  }

  // flex hoses are rebuilt every pose (in exports they are skinned meshes)
  const cables = mech.cables.map((cable) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.get('rubber')!);
    mesh.userData.cable = cable.name;
    mesh.castShadow = true;
    root.add(mesh);
    return { cable, mesh };
  });

  const byName = new Map<string, MechNode>(mech.nodes.map((n) => [n.name, n]));
  const qa = new THREE.Quaternion();

  const view: MechView = {
    root,
    objects,
    restQuat,
    materials,
    cables,
    setPose(pose: Pose) {
      for (const n of mech.nodes) {
        if (!n.joint) continue;
        const o = objects.get(n.name)!;
        const a = clampAngle(n, pose[n.name] ?? 0);
        o.quaternion.copy(restQuat.get(n.name)!);
        if (a) o.quaternion.multiply(qa.setFromAxisAngle(AXIS_VEC[n.joint.axis], a));
      }
      root.updateMatrixWorld(true);
      // piston aim constraint, solved in root space then written back as local rotations
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      const world = new Map<string, THREE.Matrix4>();
      for (const act of mech.actuators) {
        for (const nm of [act.baseNode, act.endNode]) world.set(nm, objects.get(nm)!.matrixWorld.clone().premultiply(inv));
      }
      applyActuatorAim(mech, world);
      for (const act of mech.actuators) {
        for (const nm of [act.baseNode, act.endNode]) {
          const o = objects.get(nm)!;
          const parentW = objects.get(byName.get(nm)!.parent!)!.matrixWorld.clone().premultiply(inv);
          const local = parentW.invert().multiply(world.get(nm)!);
          local.decompose(o.position, o.quaternion, o.scale);
        }
      }
      root.updateMatrixWorld(true);
      // hoses
      const rootWorld = new Map<string, THREE.Matrix4>();
      const get = (nm: string) => {
        let m = rootWorld.get(nm);
        if (!m) rootWorld.set(nm, (m = objects.get(nm)!.matrixWorld.clone().premultiply(inv)));
        return m;
      };
      for (const { cable, mesh } of cables) {
        const pts = hosePoints(worldPos(new Map([[cable.fromNode, get(cable.fromNode)]]), cable.fromNode, cable.fromOffset), worldPos(new Map([[cable.toNode, get(cable.toNode)]]), cable.toNode, cable.toOffset), cable.slack);
        const { mesh: md } = tubeAlong(pts, cable.radius, 8);
        const g = mesh.geometry;
        g.setAttribute('position', new THREE.Float32BufferAttribute(md.positions, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(md.normals, 3));
        g.setIndex(md.indices);
        g.computeBoundingSphere();
      }
    },
    dispose() {
      root.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
      for (const m of materials.values()) m.dispose();
    },
  };
  view.setPose({});
  return view;
}

/** Sagging hose between two points: a catenary-ish quadratic bezier, length ≈ distance + slack. */
export function hosePoints(a: THREE.Vector3, b: THREE.Vector3, slack: number, n = 12): THREE.Vector3[] {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const d = a.distanceTo(b);
  const sag = Math.sqrt(Math.max(0, ((d + slack) / 2) ** 2 - (d / 2) ** 2)) * 0.7;
  mid.y -= sag;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().multiplyScalar((1 - t) ** 2).add(mid.clone().multiplyScalar(2 * (1 - t) * t)).add(b.clone().multiplyScalar(t * t));
    out.push(p);
  }
  return out;
}
