/**
 * The BadMech assembly model: an articulated tree of rigid nodes.
 *
 * Conventions (also documented in docs/RIG_SPEC.md):
 *  - Units: metres. Up: +Y. Forward (the way the mech faces): +Z. Right-handed (glTF convention).
 *  - Every node's origin IS its pivot. Rotating a node's local transform rotates its subtree around it.
 *  - A joint node rotates about ONE principal local axis (x | y | z). Pose rotation is applied
 *    after the node's rest rotation:  q_pose = q_rest * axisAngle(axis, angle).
 *  - angle = 0 is the rest pose (the mech standing neutral), so limits always bracket 0.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Axis = 'x' | 'y' | 'z';

export type Role =
  | 'root'
  | 'link' // articulated rigid body (leg segment, arm segment, torso...)
  | 'group' // organisational node, no motion of its own
  | 'component' // mesh-carrying child of a link (armour, frame, housings...)
  | 'actuator' // piston cylinder / rod nodes
  | 'hatch'
  | 'socket' // attachment point, no geometry
  | 'skinned'; // deforming geometry (flex hoses)

export type ComponentKind =
  | 'frame'
  | 'armor'
  | 'joint-housing'
  | 'actuator'
  | 'equipment'
  | 'weapon'
  | 'cockpit'
  | 'glass'
  | 'interior'
  | 'detail'
  | 'light'
  | 'hose';

export type MaterialId =
  | 'paint'
  | 'paint2'
  | 'darkMetal'
  | 'steel'
  | 'rubber'
  | 'glass'
  | 'hazard'
  | 'emissive'
  | 'interior'
  | 'floor'
  | 'chrome';

export type PrimKind = 'box' | 'chamfer' | 'taper' | 'cyl' | 'sphere' | 'shape';

export interface Prim {
  kind: PrimKind;
  /** centre, node-local */
  pos: Vec3;
  /** euler XYZ radians, node-local */
  rot: Vec3;
  /** box/chamfer/taper: full size [w,h,d]. cyl: [radius, length(along local Y), radiusTop]. sphere: [r,r,r] */
  size: Vec3;
  material: MaterialId;
  /** chamfer amount (m) for 'chamfer', top scale [sx, sz] + offset for 'taper' */
  extra?: number[];
  /** radial segments for cylinders/spheres at LOD0 */
  segments?: number;
  /** hard-surface shape description (kind 'shape'); size = its bounds, centre = extra[0..2] */
  shape?: import('./hs/shapes').ShapeSpec;
  /** 0 = silhouette-critical, 1 = secondary, 2 = cosmetic greeble (dropped first in LODs) */
  detail: 0 | 1 | 2;
  /** whether this prim participates in clearance checks + collision proxies */
  collide: boolean;
  /** proxy-only: used for collision/validation, never rendered or exported as a mesh */
  hidden?: boolean;
}

export type JointPurpose = 'locomotion' | 'manipulation' | 'aim' | 'torso' | 'access' | 'suspension' | 'tool';

export interface Joint {
  axis: Axis;
  /** radians, relative to rest */
  min: number;
  max: number;
  purpose: JointPurpose;
  /** rad/s, a hint for controllers */
  maxSpeed: number;
  /** human hint: 'hip-yaw', 'knee', 'ankle-pitch', 'shoulder-pitch', ... */
  kind: string;
}

export interface MechNode {
  name: string;
  parent: string | null;
  children: string[];
  role: Role;
  /** which subsystem this belongs to: 'torso', 'leg.L0', 'arm.R', 'cockpit', 'interior', ... */
  system: string;
  component?: ComponentKind;
  position: Vec3;
  quaternion: Quat;
  joint?: Joint;
  prims: Prim[];
  tags: string[];
}

export interface Actuator {
  name: string;
  type: 'piston';
  /** node holding the cylinder barrel; its +Z must aim at `endNode` */
  baseNode: string;
  /** node holding the rod; its +Z must aim at `baseNode` */
  endNode: string;
  /** the links the two anchors are rigidly mounted on */
  baseLink: string;
  endLink: string;
  /** the joint this piston drives */
  drives: string;
  restLength: number;
  minLength: number;
  maxLength: number;
  barrelLength: number;
  rodLength: number;
}

export interface Cable {
  name: string;
  type: 'flex-hose';
  fromNode: string;
  fromOffset: Vec3;
  toNode: string;
  toOffset: Vec3;
  radius: number;
  /** extra length beyond rest distance, so the hose can follow motion without stretching */
  slack: number;
  /** name of the skinned mesh node exported for it */
  meshNode: string;
}

export interface LegChain {
  name: string;
  side: 'L' | 'R' | 'C';
  index: number;
  style: 'plantigrade' | 'digitigrade' | 'insect' | 'mammal';
  /** ordered root → tip, all joint nodes */
  joints: string[];
  /** the node whose origin is the ankle / foot pivot */
  footNode: string;
  /** point on the sole in footNode-local coords that touches the ground */
  contactOffset: Vec3;
  /** world-space rest contact point (mech at origin, rest pose) */
  restContact: Vec3;
  /** distance from first joint pivot to contact at rest, and min/max reach */
  restReach: number;
  maxReach: number;
  minReach: number;
  /** 0..1 suggested phase offset in gait cycle */
  gaitPhase: number;
}

export interface ArmChain {
  name: string;
  side: 'L' | 'R' | 'C';
  joints: string[];
  endEffector: string;
  tool: string;
}

export interface Mount {
  name: string;
  node: string;
  type: 'weapon' | 'tool' | 'sensor' | 'cargo' | 'light' | 'ladder' | 'hatch' | 'entry';
  note?: string;
}

export interface InteriorSpace {
  name: string;
  node: string;
  /** node-local AABB [min, max] */
  min: Vec3;
  max: Vec3;
  walkable: boolean;
  kind: 'cockpit' | 'deck' | 'crawlway' | 'machinery' | 'cargo';
}

export interface GaitHint {
  type: 'biped-walk' | 'quad-trot' | 'quad-walk' | 'tripod' | 'wave' | 'tetrapod';
  stepHeight: number;
  strideLength: number;
  cycleSeconds: number;
  bodyHeight: number;
  /** legs grouped by simultaneous swing */
  groups: string[][];
  /** filled in by calibrateGait(): the reference controller tracked this gait within tolerance */
  verified?: { maxFootErrorM: number; meanFootErrorM: number; strideScaled: number };
}

export interface Mech {
  name: string;
  family: string;
  /** manufacturer id (Mech Factory); 'generic' for pre-factory recipes */
  maker: string;
  nodes: MechNode[];
  actuators: Actuator[];
  cables: Cable[];
  legs: LegChain[];
  arms: ArmChain[];
  mounts: Mount[];
  interiors: InteriorSpace[];
  gait: GaitHint;
  /** materials colours resolved for this mech */
  palette: Record<MaterialId, PaletteEntry>;
  stats: {
    height: number;
    width: number;
    length: number;
    estimatedMassTonnes: number;
    sizeClass: string;
  };
}

export interface PaletteEntry {
  color: [number, number, number];
  metallic: number;
  roughness: number;
  emissive?: [number, number, number];
  alpha?: number;
}

export type Pose = Record<string, number>;
