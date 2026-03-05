import {
  type Scene,
  AbstractMesh,
  Mesh,
  VertexData,
  VertexBuffer,
  Matrix,
  Vector3,
  PBRMetallicRoughnessMaterial,
  Color3,
  Constants,
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

// Build a reverse lookup from numeric type codes to IFC type names (e.g. 2391406946 → "IFCWALL")
const ifcTypeCodeToName = new Map<number, string>();
for (const [name, value] of Object.entries(WEBIFC)) {
  if (typeof value === "number" && name.startsWith("IFC")) {
    ifcTypeCodeToName.set(value, name);
  }
}

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
  {
    typeCode: WEBIFC.IFCMEMBER,
    priority: 3,
    occlusion: OcclusionPolicy.Enabled,
    label: "Member",
  },
  {
    typeCode: WEBIFC.IFCBUILDINGELEMENTPROXY,
    priority: 1,
    occlusion: OcclusionPolicy.Disabled,
    label: "BuildingElementProxy",
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

export interface IfcCategoryInfo {
  label: string;
  priority: 1 | 2 | 3;
  count: number;
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
  onCategories?: (categories: IfcCategoryInfo[]) => void,
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
  const loggedOtherTypes = new Set<number>();
  ifcAPI.StreamAllMeshes(modelId, (flatMesh) => {
    if (seenExpressIDs.has(flatMesh.expressID)) return;
    seenExpressIDs.add(flatMesh.expressID);
    collected.push({ expressID: flatMesh.expressID, config: defaultConfig });

    // Log uncategorized IFC types once per type so we can identify missing categories
    const line = ifcAPI.GetLine(modelId, flatMesh.expressID);
    const typeCode = line?.type;
    if (typeCode != null && !loggedOtherTypes.has(typeCode)) {
      loggedOtherTypes.add(typeCode);
      const typeName =
        ifcTypeCodeToName.get(typeCode) ?? `Unknown(${typeCode})`;
      console.warn(
        `[IFC] Uncategorized element type: ${typeName} (code ${typeCode})`,
      );
    }
  });

  const totalElements = collected.length;

  // ---- Process collected elements (already in priority order) ----

  // Block material dirty checks during bulk mesh creation — we'll reconcile once at the end.
  scene.blockMaterialDirtyMechanism = true;

  const meshCache = new Map<string, { mesh: Mesh; entry: IfcMeshEntry }>();
  const materialCache = new Map<string, PBRMetallicRoughnessMaterial>();
  const allEntries: IfcMeshEntry[] = [];

  // Track category counts progressively for the UI
  const categoryCounts = new Map<
    string,
    { priority: 1 | 2 | 3; count: number }
  >();
  let categoriesDirty = false;

  function emitCategories() {
    if (!categoriesDirty || !onCategories) return;
    categoriesDirty = false;
    const cats: IfcCategoryInfo[] = Array.from(
      categoryCounts,
      ([label, { priority, count }]) => ({ label, priority, count }),
    ).sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
    onCategories(cats);
  }

  for (let i = 0; i < totalElements; i++) {
    const element = collected[i];
    const flatMesh = ifcAPI.GetFlatMesh(modelId, element.expressID);

    const entriesBefore = allEntries.length;
    const { nCreated } = processFlatMesh(
      flatMesh,
      element.config,
      modelId,
      scene,
      meshCache,
      materialCache,
      allEntries,
    );

    // Update category counts for any newly created entries
    for (let e = entriesBefore; e < allEntries.length; e++) {
      const meta = allEntries[e].meta;
      const existing = categoryCounts.get(meta.ifcTypeLabel);
      if (existing) {
        existing.count++;
      } else {
        categoryCounts.set(meta.ifcTypeLabel, {
          priority: meta.priority,
          count: 1,
        });
      }
      categoriesDirty = true;
    }

    if (flatMesh.delete) flatMesh.delete();

    // Report progress and yield to the browser periodically so the UI can update
    const pct = Math.round(((i + 1) / totalElements) * 100);
    onProgress?.(pct);

    if (i % 20 === 0 && nCreated > 0) {
      emitCategories();
      // Only do a setTimeout if we actually created new meshes. If we're just adding
      // thin instances to existing meshes, we can do that in a tight loop without yielding.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Final emit to capture any remaining updates
  emitCategories();

  // Restore material dirty mechanism and reconcile all materials once
  scene.blockMaterialDirtyMechanism = false;
  scene.markAllMaterialsAsDirty(Constants.MATERIAL_AllDirtyFlag);

  // Freeze materials — model is static, no material property changes after load
  for (const mat of materialCache.values()) {
    mat.freeze();
  }

  // All instances added — make meshes visible and freeze transforms
  for (const entry of allEntries) {
    entry.mesh.setEnabled(true);
    entry.mesh.freezeWorldMatrix();
    entry.mesh.doNotSyncBoundingInfo = true;
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

// ---------------------------------------------------------------------------
// Post-load mesh merging — reduces draw calls by combining meshes that share
// the same material and IFC category into single merged meshes.
// ---------------------------------------------------------------------------

/**
 * Bake a thin-instanced mesh into a single VertexData with all instance
 * transforms applied to the vertex positions and normals.
 */
function bakeThinInstances(mesh: Mesh): VertexData {
  const basePositions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const baseNormals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const baseIndices = mesh.getIndices()!;
  const instanceCount = mesh.thinInstanceCount;

  // Read the raw matrix buffer (16 floats per instance, column-major)
  const matrixBuffer =
    mesh._thinInstanceDataStorage?.matrixData as Float32Array | undefined;

  // If there are no thin instances or no matrix data, return the base geometry as-is
  if (!matrixBuffer || instanceCount <= 0) {
    const vd = new VertexData();
    vd.positions = new Float32Array(basePositions);
    vd.normals = new Float32Array(baseNormals);
    vd.indices = new Int32Array(baseIndices);
    return vd;
  }

  const vertexCount = basePositions.length / 3;
  const indexCount = baseIndices.length;

  const allPositions = new Float32Array(vertexCount * 3 * instanceCount);
  const allNormals = new Float32Array(vertexCount * 3 * instanceCount);
  const allIndices = new Int32Array(indexCount * instanceCount);

  const tmpPos = new Vector3();
  const tmpNorm = new Vector3();

  for (let inst = 0; inst < instanceCount; inst++) {
    const matrix = Matrix.FromArray(matrixBuffer, inst * 16);
    const posOffset = inst * vertexCount * 3;
    const idxOffset = inst * indexCount;
    const vertOffset = inst * vertexCount;

    // Transform positions
    for (let v = 0; v < vertexCount; v++) {
      const s = v * 3;
      tmpPos.set(basePositions[s], basePositions[s + 1], basePositions[s + 2]);
      Vector3.TransformCoordinatesToRef(tmpPos, matrix, tmpPos);
      allPositions[posOffset + s] = tmpPos.x;
      allPositions[posOffset + s + 1] = tmpPos.y;
      allPositions[posOffset + s + 2] = tmpPos.z;
    }

    // Transform normals (direction only — upper 3x3)
    for (let v = 0; v < vertexCount; v++) {
      const s = v * 3;
      tmpNorm.set(baseNormals[s], baseNormals[s + 1], baseNormals[s + 2]);
      Vector3.TransformNormalToRef(tmpNorm, matrix, tmpNorm);
      tmpNorm.normalizeToRef(tmpNorm);
      allNormals[posOffset + s] = tmpNorm.x;
      allNormals[posOffset + s + 1] = tmpNorm.y;
      allNormals[posOffset + s + 2] = tmpNorm.z;
    }

    // Offset indices
    for (let i = 0; i < indexCount; i++) {
      allIndices[idxOffset + i] = baseIndices[i] + vertOffset;
    }
  }

  const vd = new VertexData();
  vd.positions = allPositions;
  vd.normals = allNormals;
  vd.indices = allIndices;
  return vd;
}

/**
 * Merge meshes in a LoadedModel that share the same material and IFC category.
 * Meshes with more than `instanceThreshold` thin instances are kept as-is
 * (hardware instancing is already efficient for those).
 *
 * Returns a new LoadedModel with the merged entries.
 */
export function mergeLoadedModel(
  model: LoadedModel,
  scene: Scene,
  instanceThreshold = 10,
): LoadedModel {
  // Group entries by material + category
  const groups = new Map<
    string,
    { toMerge: IfcMeshEntry[]; toKeep: IfcMeshEntry[] }
  >();

  for (const entry of model.entries) {
    const matId = entry.mesh.material?.uniqueId ?? 0;
    const groupKey = `${matId}|${entry.meta.ifcTypeLabel}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { toMerge: [], toKeep: [] };
      groups.set(groupKey, group);
    }

    if (entry.mesh.thinInstanceCount > instanceThreshold) {
      group.toKeep.push(entry);
    } else {
      group.toMerge.push(entry);
    }
  }

  const newEntries: IfcMeshEntry[] = [];
  let mergedCount = 0;
  let keptCount = 0;

  for (const [, group] of groups) {
    // Keep high-instance meshes as-is
    for (const entry of group.toKeep) {
      newEntries.push(entry);
      keptCount++;
    }

    // Merge low-instance meshes in this group
    if (group.toMerge.length === 0) continue;

    // If only 1 mesh with 1 instance, no benefit to merging — keep it
    if (
      group.toMerge.length === 1 &&
      group.toMerge[0].mesh.thinInstanceCount <= 1
    ) {
      newEntries.push(group.toMerge[0]);
      keptCount++;
      continue;
    }

    // Bake and merge
    const bakedMeshes: Mesh[] = [];
    const allExpressIDs: number[] = [];
    const representativeEntry = group.toMerge[0];
    const sharedMaterial = representativeEntry.mesh.material;

    for (const entry of group.toMerge) {
      const vd = bakeThinInstances(entry.mesh);
      const baked = new Mesh(`baked-${entry.mesh.name}`, scene);
      vd.applyToMesh(baked);
      baked.material = sharedMaterial;
      bakedMeshes.push(baked);
      allExpressIDs.push(...entry.expressIDs);

      // Dispose the original thin-instance mesh
      entry.mesh.dispose(false, false);
    }

    const merged = Mesh.MergeMeshes(
      bakedMeshes,
      true, // disposeSource
      true, // allow32BitsIndices
    );

    if (merged) {
      merged.material = sharedMaterial;
      // Merged meshes span large areas — occlusion queries on their bounding
      // box cause entire categories to vanish when the camera is inside the
      // building.  Draw-call savings come from the merge itself, so skip
      // occlusion on these.
      merged.occlusionType = AbstractMesh.OCCLUSION_TYPE_NONE;
      merged.freezeWorldMatrix();
      merged.doNotSyncBoundingInfo = true;

      newEntries.push({
        mesh: merged,
        meta: { ...representativeEntry.meta },
        expressIDs: allExpressIDs,
      });
      mergedCount += group.toMerge.length;
    }
  }

  console.log(
    `Mesh merge complete: ${model.entries.length} → ${newEntries.length} meshes ` +
      `(merged ${mergedCount}, kept ${keptCount})`,
  );

  return {
    entries: newEntries,
    dispose() {
      for (const entry of newEntries) {
        entry.mesh.dispose(false, false);
      }
    },
  };
}
