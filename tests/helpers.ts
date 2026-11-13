import type { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Parse GLB bytes with three's stock GLTFLoader (the same loader the web app uses). */
export function loadGlb(bytes: Uint8Array): Promise<{ scene: Object3D; json: any }> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((res, rej) =>
    new GLTFLoader().parse(ab as ArrayBuffer, '', (g) => res({ scene: g.scene, json: (g as any).parser.json }), rej),
  );
}
