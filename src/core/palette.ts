import type { MaterialId, PaletteEntry } from './model';

/** Paint schemes, sampled from Noor's concept art. */
export const SCHEMES: Record<string, { label: string; paint: string; paint2: string; hazard: string; light: string }> = {
  olive: { label: 'Olive Drab (A-73)', paint: '#5d6047', paint2: '#a9a28c', hazard: '#d9a227', light: '#ffb347' },
  industrial: { label: 'Site Yellow (Hauler)', paint: '#d29a1e', paint2: '#3a3a36', hazard: '#e2b230', light: '#ffd27a' },
  warcamo: { label: 'Bone & Rust (A-07)', paint: '#b7b09a', paint2: '#4f553e', hazard: '#b2382c', light: '#ff9d4a' },
  scout: { label: 'Lynx White (S1)', paint: '#d9d6cc', paint2: '#2d2f31', hazard: '#d85a24', light: '#ffc76b' },
  urban: { label: 'Urban Grey (M-47)', paint: '#77797a', paint2: '#c8c3b4', hazard: '#d47b1f', light: '#ffb85c' },
  rust: { label: 'Salvage Rust', paint: '#7a4b2f', paint2: '#54524b', hazard: '#c99a2e', light: '#ffa64d' },
  arctic: { label: 'Arctic', paint: '#e4e8ea', paint2: '#56626b', hazard: '#c8322e', light: '#a8e3ff' },
};

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  // sRGB → linear for glTF baseColorFactor
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

export function makePalette(scheme: string): Record<MaterialId, PaletteEntry> {
  const s = SCHEMES[scheme] ?? SCHEMES.olive;
  const light = hex(s.light);
  return {
    paint: { color: hex(s.paint), metallic: 0.35, roughness: 0.62 },
    paint2: { color: hex(s.paint2), metallic: 0.35, roughness: 0.66 },
    darkMetal: { color: hex('#2a2b2c'), metallic: 0.8, roughness: 0.55 },
    steel: { color: hex('#7d7f80'), metallic: 0.9, roughness: 0.42 },
    chrome: { color: hex('#c9ccce'), metallic: 1.0, roughness: 0.16 },
    rubber: { color: hex('#151515'), metallic: 0.0, roughness: 0.9 },
    glass: { color: hex('#3b2a12'), metallic: 0.1, roughness: 0.08, alpha: 0.55, emissive: [light[0] * 0.08, light[1] * 0.08, light[2] * 0.08] },
    hazard: { color: hex(s.hazard), metallic: 0.3, roughness: 0.55 },
    emissive: { color: light, metallic: 0, roughness: 0.4, emissive: light },
    interior: { color: hex('#3c3d3a'), metallic: 0.2, roughness: 0.75 },
    floor: { color: hex('#4a4a46'), metallic: 0.6, roughness: 0.7 },
  };
}

export const MATERIAL_NAMES: Record<MaterialId, string> = {
  paint: 'BM_Paint_Primary',
  paint2: 'BM_Paint_Secondary',
  darkMetal: 'BM_Metal_Dark',
  steel: 'BM_Metal_Steel',
  chrome: 'BM_Metal_Chrome',
  rubber: 'BM_Rubber',
  glass: 'BM_Glass_Canopy',
  hazard: 'BM_Paint_Hazard',
  emissive: 'BM_Light_Emissive',
  interior: 'BM_Interior_Panel',
  floor: 'BM_Interior_Floor',
};
