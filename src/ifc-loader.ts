import {
  type Scene,
  AbstractMesh,
  Mesh,
  VertexData,
  Matrix,
  PBRMetallicRoughnessMaterial,
  Color3,
} from "@babylonjs/core";
import * as WEBIFC from "web-ifc";

import wasmURL from "web-ifc/web-ifc.wasm?url";

const ifcAPI = new WEBIFC.IfcAPI();

// We need to set the directory for the WASM file, as normally it'd
// try to read it out of the root of the server. (SetWasmPath is somewhat
// confusingly named -- it doesn't include the filename). We want to serve it out of
// node_modules so that we don't have to copy it into our public directory. (
// which could be problematic if someone updated the library and we forgot to update
// our copy of the WASM file).
const wasmDir = wasmURL.substring(0, wasmURL.lastIndexOf("/") + 1);
ifcAPI.SetWasmPath(wasmDir);

let loaderInitialized = false;

// ---------------------------------------------------------------------------
// IFC type configuration — priority and occlusion policy per element type
// ---------------------------------------------------------------------------

const enum OcclusionPolicy {
  Enabled,
  Disabled,
}

interface IfcTypeConfig {
  typeCode: number;
  priority: 1 | 2 | 3;
  occlusion: OcclusionPolicy;
  label: string;
}

const IFC_TYPE_CONFIGS: IfcTypeConfig[] = [
  // Priority 1 — external / structural shell
  {
    typeCode: WEBIFC.IFCWALL,
    priority: 1,
    occlusion: OcclusionPolicy.Enabled,
    label: "Wall",
  },
  {
    typeCode: WEBIFC.IFCWALLSTANDARDCASE,
    priority: 1,
    occlusion: OcclusionPolicy.Enabled,
    label: "WallStandardCase",
  },
  {
    typeCode: WEBIFC.IFCROOF,
    priority: 1,
    occlusion: OcclusionPolicy.Enabled,
    label: "Roof",
  },
  {
    typeCode: WEBIFC.IFCSLAB,
    priority: 1,
    occlusion: OcclusionPolicy.Enabled,
    label: "Slab",
  },
  {
    typeCode: WEBIFC.IFCCURTAINWALL,
    priority: 1,
    occlusion: OcclusionPolicy.Disabled,
    label: "CurtainWall",
  },
  {
    typeCode: WEBIFC.IFCWINDOW,
    priority: 1,
    occlusion: OcclusionPolicy.Disabled,
    label: "Window",
  },

  // Priority 2 — openings and circulation
  {
    typeCode: WEBIFC.IFCDOOR,
    priority: 2,
    occlusion: OcclusionPolicy.Enabled,
    label: "Door",
  },
  {
    typeCode: WEBIFC.IFCSTAIR,
    priority: 2,
    occlusion: OcclusionPolicy.Enabled,
    label: "Stair",
  },
  {
    typeCode: WEBIFC.IFCSTAIRFLIGHT,
    priority: 2,
    occlusion: OcclusionPolicy.Enabled,
    label: "StairFlight",
  },
  {
    typeCode: WEBIFC.IFCRAILING,
    priority: 2,
    occlusion: OcclusionPolicy.Enabled,
    label: "Railing",
  },

  // Priority 3 — internal detail
  {
    typeCode: WEBIFC.IFCBEAM,
    priority: 3,
    occlusion: OcclusionPolicy.Enabled,
    label: "Beam",
  },
  {
    typeCode: WEBIFC.IFCCOLUMN,
    priority: 3,
    occlusion: OcclusionPolicy.Enabled,
    label: "Column",
  },
  {
    typeCode: WEBIFC.IFCFURNISHINGELEMENT,
    priority: 3,
    occlusion: OcclusionPolicy.Enabled,
    label: "FurnishingElement",
  },
];

// ---------------------------------------------------------------------------
// Custom mesh wrapper types
// ---------------------------------------------------------------------------

export interface IfcElementMeta {
  ifcType: number;
  ifcTypeLabel: string;
  priority: 1 | 2 | 3;
}

export interface IfcMeshEntry {
  mesh: Mesh;
  meta: IfcElementMeta;
  /** Express IDs of IFC elements that contributed thin instances to this mesh */
  expressIDs: number[];
}

export interface LoadedModel {
  entries: IfcMeshEntry[];
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Collected element reference (lightweight — just IDs and config, no geometry)
// ---------------------------------------------------------------------------

interface CollectedElement {
  expressID: number;
  config: IfcTypeConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function colorKey(c: { x: number; y: number; z: number; w: number }): string {
  return `${c.x}_${c.y}_${c.z}_${c.w}`;
}

function getOrCreateMaterial(
  scene: Scene,
  color: { x: number; y: number; z: number; w: number },
  cache: Map<string, PBRMetallicRoughnessMaterial>,
): PBRMetallicRoughnessMaterial {
  const key = colorKey(color);
  let mat = cache.get(key);
  if (mat) return mat;

  mat = new PBRMetallicRoughnessMaterial(`ifc-mat-${key}`, scene);
  mat.baseColor = new Color3(color.x, color.y, color.z);
  mat.metallic = 0;
  mat.roughness = 1;
  mat.backFaceCulling = false;
  if (color.w < 1) {
    mat.alpha = color.w;
    mat.transparencyMode = PBRMetallicRoughnessMaterial.MATERIAL_ALPHABLEND;
  }
  cache.set(key, mat);
  return mat;
}

function createMeshFromGeometry(
  name: string,
  modelId: number,
  geometryExpressID: number,
  scene: Scene,
): Mesh | null {
  const ifcGeom = ifcAPI.GetGeometry(modelId, geometryExpressID);
  const vRaw = ifcAPI.GetVertexArray(
    ifcGeom.GetVertexData(),
    ifcGeom.GetVertexDataSize(),
  );
  const indices = ifcAPI.GetIndexArray(
    ifcGeom.GetIndexData(),
    ifcGeom.GetIndexDataSize(),
  );
  ifcGeom.delete();

  if (vRaw.length === 0) return null;

  // De-interleave: 6 floats per vertex [x, y, z, nx, ny, nz]
  // Negate Z to convert from IFC right-handed to Babylon.js left-handed
  const vertexCount = vRaw.length / 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const s = i * 6;
    const d = i * 3;
    positions[d] = vRaw[s];
    positions[d + 1] = vRaw[s + 1];
    positions[d + 2] = -vRaw[s + 2];
    normals[d] = vRaw[s + 3];
    normals[d + 1] = vRaw[s + 4];
    normals[d + 2] = -vRaw[s + 5];
  }

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh);

  return mesh;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/** Process a single FlatMesh into the mesh cache, creating or reusing Babylon meshes. */
function processFlatMesh(
  flatMesh: WEBIFC.FlatMesh,
  config: IfcTypeConfig,
  modelId: number,
  scene: Scene,
  meshCache: Map<string, { mesh: Mesh; entry: IfcMeshEntry }>,
  materialCache: Map<string, PBRMetallicRoughnessMaterial>,
  allEntries: IfcMeshEntry[],
): { nCached: number; nCreated: number } {
  let nCached = 0;
  let nCreated = 0;

  for (let j = 0; j < flatMesh.geometries.size(); j++) {
    const pg = flatMesh.geometries.get(j);
    const ck = colorKey(pg.color);
    const cacheKey = `${pg.geometryExpressID}_${ck}_${config.occlusion}`;
    const transform = Matrix.FromArray(pg.flatTransformation);

    let cached = meshCache.get(cacheKey);
    if (!cached) {
      nCreated++;
      const mesh = createMeshFromGeometry(
        `ifc-geo-${cacheKey}`,
        modelId,
        pg.geometryExpressID,
        scene,
      );
      if (!mesh) continue;

      mesh.material = getOrCreateMaterial(scene, pg.color, materialCache);

      // Apply occlusion culling based on element type
      mesh.occlusionType =
        config.occlusion === OcclusionPolicy.Enabled
          ? AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC
          : AbstractMesh.OCCLUSION_TYPE_NONE;

      const entry: IfcMeshEntry = {
        mesh,
        meta: {
          ifcType: config.typeCode,
          ifcTypeLabel: config.label,
          priority: config.priority,
        },
        expressIDs: [flatMesh.expressID],
      };
      cached = { mesh, entry };
      meshCache.set(cacheKey, cached);
      allEntries.push(entry);
    } else {
      if (!cached.entry.expressIDs.includes(flatMesh.expressID)) {
        cached.entry.expressIDs.push(flatMesh.expressID);

        nCached++;
      }
    }

    cached.mesh.thinInstanceAdd(transform);
  }
  return {
    nCached,
    nCreated,
  };
}

export async function loadIfcModel(
  scene: Scene,
  data: Uint8Array,
  onProgress?: (pct: number) => void,
): Promise<LoadedModel> {
  if (!loaderInitialized) {
    await ifcAPI.Init();
    loaderInitialized = true;
    console.log("IFC loader initialized");
  }

  console.log(`Loading IFC model... ${data.length} bytes`);

  const modelId = ifcAPI.OpenModel(data);

  // ---- Collect element express IDs by priority ----
  // Use GetLineIDsWithType for lightweight ID collection, then GetFlatMesh
  // per element during processing (ensures geometry data is available).

  const collected: CollectedElement[] = [];
  const seenExpressIDs = new Set<number>();

  for (const priority of [1, 2, 3] as const) {
    for (const config of IFC_TYPE_CONFIGS.filter(
      (c) => c.priority === priority,
    )) {
      const ids = ifcAPI.GetLineIDsWithType(modelId, config.typeCode);
      for (let k = 0; k < ids.size(); k++) {
        const expressID = ids.get(k);
        if (seenExpressIDs.has(expressID)) continue;
        seenExpressIDs.add(expressID);
        collected.push({ expressID, config });
      }
    }
  }

  // Catch-all: any elements with geometry not covered by the config table
  const defaultConfig: IfcTypeConfig = {
    typeCode: 0,
    priority: 3,
    occlusion: OcclusionPolicy.Enabled,
    label: "Other",
  };
  ifcAPI.StreamAllMeshes(modelId, (flatMesh) => {
    if (seenExpressIDs.has(flatMesh.expressID)) return;
    seenExpressIDs.add(flatMesh.expressID);
    collected.push({ expressID: flatMesh.expressID, config: defaultConfig });
  });

  const totalElements = collected.length;

  // ---- Process collected elements (already in priority order) ----

  const meshCache = new Map<string, { mesh: Mesh; entry: IfcMeshEntry }>();
  const materialCache = new Map<string, PBRMetallicRoughnessMaterial>();
  const allEntries: IfcMeshEntry[] = [];

  for (let i = 0; i < totalElements; i++) {
    const element = collected[i];
    const flatMesh = ifcAPI.GetFlatMesh(modelId, element.expressID);

    const { nCreated } = processFlatMesh(
      flatMesh,
      element.config,
      modelId,
      scene,
      meshCache,
      materialCache,
      allEntries,
    );

    if (flatMesh.delete) flatMesh.delete();

    // Report progress and yield to the browser periodically so the UI can update
    const pct = Math.round(((i + 1) / totalElements) * 100);
    onProgress?.(pct);

    if (i % 20 === 0 && nCreated > 0) {
      // Only do a setTimeout if we actually created new meshes. If we're just adding
      // thin instances to existing meshes, we can do that in a tight loop without yielding.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // All instances added — make meshes visible
  for (const entry of allEntries) {
    entry.mesh.setEnabled(true);
  }

  ifcAPI.CloseModel(modelId);

  console.log(
    `IFC model loaded: ${allEntries.length} unique meshes, ${totalElements} elements`,
  );

  return {
    entries: allEntries,
    dispose() {
      for (const entry of allEntries) {
        entry.mesh.dispose(false, false);
      }
      for (const mat of materialCache.values()) {
        mat.dispose();
      }
    },
  };
}
