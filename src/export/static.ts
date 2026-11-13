/** OBJ+MTL (static) and USDA (articulated transform hierarchy) writers. */
import { Matrix3, Vector3 } from 'three';
import { buildNodeMeshes, LODS } from '../core/geometry';
import { worldMatrices } from '../core/kinematics';
import type { MaterialId, Mech } from '../core/model';
import { MATERIAL_NAMES } from '../core/palette';

const f = (x: number) => (Math.abs(x) < 1e-7 ? '0' : x.toFixed(5).replace(/\.?0+$/, ''));

export function exportObj(mech: Mech, base: string, lod: 0 | 1 | 2 = 0): { obj: string; mtl: string } {
  const rest = worldMatrices(mech, {});
  const lines: string[] = [
    `# BadMech OBJ export: ${mech.name}`,
    '# WARNING: OBJ is STATIC GEOMETRY ONLY. It carries no hierarchy, pivots, joints, limits,',
    '# pistons, IK chains or controller metadata. Parts are baked in the rest pose in world space.',
    `# Use ${base}.glb (or .fbx/.blend via the Blender bridge) + ${base}.rig.json for anything that moves.`,
    '# Units: metres, +Y up, mech faces +Z.',
    `mtllib ${base}.mtl`,
  ];
  let vOff = 1;
  for (const n of mech.nodes) {
    const meshes = buildNodeMeshes(n, LODS[lod]);
    if (![...meshes.values()].some((d) => d.indices.length)) continue;
    const w = rest.get(n.name)!;
    const nm = new Matrix3().getNormalMatrix(w);
    lines.push(`o ${n.name}`);
    for (const [mat, d] of meshes) {
      if (!d.indices.length) continue;
      const v = new Vector3();
      for (let i = 0; i < d.positions.length; i += 3) {
        v.set(d.positions[i], d.positions[i + 1], d.positions[i + 2]).applyMatrix4(w);
        lines.push(`v ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
      }
      for (let i = 0; i < d.uvs.length; i += 2) lines.push(`vt ${f(d.uvs[i])} ${f(d.uvs[i + 1])}`);
      for (let i = 0; i < d.normals.length; i += 3) {
        v.set(d.normals[i], d.normals[i + 1], d.normals[i + 2]).applyMatrix3(nm).normalize();
        lines.push(`vn ${f(v.x)} ${f(v.y)} ${f(v.z)}`);
      }
      lines.push(`usemtl ${MATERIAL_NAMES[mat]}`);
      for (let i = 0; i < d.indices.length; i += 3) {
        const a = d.indices[i] + vOff;
        const b = d.indices[i + 1] + vOff;
        const c = d.indices[i + 2] + vOff;
        lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
      }
      vOff += d.positions.length / 3;
    }
  }
  const mtl: string[] = [`# BadMech materials for ${mech.name} (PBR extension keys Pr/Pm/Ke included)`];
  for (const [id, e] of Object.entries(mech.palette) as [MaterialId, (typeof mech.palette)[MaterialId]][]) {
    mtl.push(`newmtl ${MATERIAL_NAMES[id]}`, `Kd ${e.color.map(f).join(' ')}`, `Ks 0.04 0.04 0.04`, `Ns ${f((1 - e.roughness) * 500)}`, `Pr ${f(e.roughness)}`, `Pm ${f(e.metallic)}`);
    if (e.alpha !== undefined) mtl.push(`d ${f(e.alpha)}`);
    if (e.emissive) mtl.push(`Ke ${e.emissive.map(f).join(' ')}`);
    mtl.push('illum 2', '');
  }
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') };
}

const usdName = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

/**
 * USDA: articulated Xform hierarchy (same pivots/names as the GLB), meshes with normals + UVs,
 * UsdPreviewSurface materials. Joint metadata rides along as customData on each Xform.
 * Not included: UsdPhysics joints, UsdSkel hoses (documented in docs/EXPORT_FORMATS.md).
 */
export function exportUsda(mech: Mech, lod: 0 | 1 | 2 = 0): string {
  const out: string[] = [];
  out.push('#usda 1.0', '(', `    defaultPrim = "${usdName(mech.name)}"`, '    metersPerUnit = 1', '    upAxis = "Y"', `    doc = "BadMech export: ${mech.name}. Rig metadata: see customData and the .rig.json sidecar."`, ')', '');
  const byParent = new Map<string | null, typeof mech.nodes>();
  for (const n of mech.nodes) {
    const k = n.parent;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(n);
  }
  const ind = (d: number) => '    '.repeat(d);
  const emit = (n: (typeof mech.nodes)[number], d: number) => {
    out.push(`${ind(d)}def Xform "${usdName(n.name)}" (`);
    const cd: string[] = [`string role = "${n.role}"`, `string system = "${n.system}"`];
    if (n.component) cd.push(`string component = "${n.component}"`);
    if (n.joint) {
      const j = n.joint;
      cd.push(`string jointAxis = "${j.axis}"`, `double jointMin = ${f(j.min)}`, `double jointMax = ${f(j.max)}`, `string jointKind = "${j.kind}"`, `string jointPurpose = "${j.purpose}"`, `bool continuous = ${n.tags.includes('continuous') ? 1 : 0}`);
    }
    out.push(`${ind(d + 1)}customData = {`, ...cd.map((c) => `${ind(d + 2)}${c}`), `${ind(d + 1)}}`, `${ind(d)})`, `${ind(d)}{`);
    const q = n.quaternion;
    out.push(`${ind(d + 1)}double3 xformOp:translate = (${n.position.map(f).join(', ')})`);
    out.push(`${ind(d + 1)}quatf xformOp:orient = (${f(q[3])}, ${f(q[0])}, ${f(q[1])}, ${f(q[2])})`);
    out.push(`${ind(d + 1)}uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]`);
    const meshes = buildNodeMeshes(n, LODS[lod]);
    for (const [mat, m] of meshes) {
      if (!m.indices.length) continue;
      out.push(`${ind(d + 1)}def Mesh "${mat}_geo" (`, `${ind(d + 2)}prepend apiSchemas = ["MaterialBindingAPI"]`, `${ind(d + 1)})`, `${ind(d + 1)}{`);
      const pts: string[] = [];
      for (let i = 0; i < m.positions.length; i += 3) pts.push(`(${f(m.positions[i])}, ${f(m.positions[i + 1])}, ${f(m.positions[i + 2])})`);
      const nrm: string[] = [];
      for (let i = 0; i < m.normals.length; i += 3) nrm.push(`(${f(m.normals[i])}, ${f(m.normals[i + 1])}, ${f(m.normals[i + 2])})`);
      const st: string[] = [];
      for (let i = 0; i < m.uvs.length; i += 2) st.push(`(${f(m.uvs[i])}, ${f(m.uvs[i + 1])})`);
      out.push(`${ind(d + 2)}uniform token subdivisionScheme = "none"`);
      out.push(`${ind(d + 2)}int[] faceVertexCounts = [${new Array(m.indices.length / 3).fill(3).join(', ')}]`);
      out.push(`${ind(d + 2)}int[] faceVertexIndices = [${m.indices.join(', ')}]`);
      out.push(`${ind(d + 2)}point3f[] points = [${pts.join(', ')}]`);
      out.push(`${ind(d + 2)}normal3f[] normals = [${nrm.join(', ')}] (`, `${ind(d + 3)}interpolation = "vertex"`, `${ind(d + 2)})`);
      out.push(`${ind(d + 2)}texCoord2f[] primvars:st = [${st.join(', ')}] (`, `${ind(d + 3)}interpolation = "vertex"`, `${ind(d + 2)})`);
      out.push(`${ind(d + 2)}rel material:binding = </${usdName(mech.name)}/Materials/${MATERIAL_NAMES[mat]}>`);
      out.push(`${ind(d + 1)}}`);
    }
    for (const c of byParent.get(n.name) ?? []) emit(c, d + 1);
    out.push(`${ind(d)}}`);
  };
  out.push(`def Xform "${usdName(mech.name)}" (`, '    kind = "component"', ')', '{');
  for (const r of byParent.get(null) ?? []) emit(r, 1);
  out.push('    def Scope "Materials"', '    {');
  for (const [id, e] of Object.entries(mech.palette) as [MaterialId, (typeof mech.palette)[MaterialId]][]) {
    const nm = MATERIAL_NAMES[id];
    out.push(
      `        def Material "${nm}"`,
      '        {',
      `            token outputs:surface.connect = </${usdName(mech.name)}/Materials/${nm}/Surface.outputs:surface>`,
      '            def Shader "Surface"',
      '            {',
      '                uniform token info:id = "UsdPreviewSurface"',
      `                color3f inputs:diffuseColor = (${e.color.map(f).join(', ')})`,
      `                float inputs:metallic = ${f(e.metallic)}`,
      `                float inputs:roughness = ${f(e.roughness)}`,
      `                float inputs:opacity = ${f(e.alpha ?? 1)}`,
      e.emissive ? `                color3f inputs:emissiveColor = (${e.emissive.map(f).join(', ')})` : '',
      '                token outputs:surface',
      '            }',
      '        }',
    );
  }
  out.push('    }', '}', '');
  return out.filter((l) => l !== '').join('\n') + '\n';
}
