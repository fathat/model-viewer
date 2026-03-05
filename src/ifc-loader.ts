import {
  type Scene,
  Mesh,
  VertexData,
  Matrix,
  StandardMaterial,
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

export interface LoadedModel {
  meshes: Mesh[];
  dispose(): void;
}

function colorKey(c: WEBIFC.Color): string {
  return `${c.x}_${c.y}_${c.z}_${c.w}`;
}

function getOrCreateMaterial(
  scene: Scene,
  color: WEBIFC.Color,
  cache: Map<string, StandardMaterial>,
): StandardMaterial {
  const key = colorKey(color);
  let mat = cache.get(key);
  if (mat) return mat;

  mat = new StandardMaterial(`ifc-mat-${key}`, scene);
  mat.diffuseColor = new Color3(color.x, color.y, color.z);
  mat.backFaceCulling = false;
  if (color.w < 1) {
    mat.alpha = color.w;
    mat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
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
  const flatMeshes = ifcAPI.LoadAllGeometry(modelId);
  const totalElements = flatMeshes.size();

  // Cache key: "geoExpressID_colorKey" -> source Mesh (for thin instancing)
  const meshCache = new Map<string, Mesh>();
  const materialCache = new Map<string, StandardMaterial>();
  const allMeshes: Mesh[] = [];

  for (let i = 0; i < totalElements; i++) {
    const flatMesh = flatMeshes.get(i);

    for (let j = 0; j < flatMesh.geometries.size(); j++) {
      const pg = flatMesh.geometries.get(j);
      const ck = colorKey(pg.color);
      const cacheKey = `${pg.geometryExpressID}_${ck}`;
      const transform = Matrix.FromArray(pg.flatTransformation);

      const cached = meshCache.get(cacheKey);
      let mesh: Mesh;
      if (!cached) {
        const created = createMeshFromGeometry(
          `ifc-geo-${cacheKey}`,
          modelId,
          pg.geometryExpressID,
          scene,
        );
        if (!created) continue;
        mesh = created;

        mesh.material = getOrCreateMaterial(scene, pg.color, materialCache);
        //mesh.setEnabled(false); // Hide until all instances are added
        meshCache.set(cacheKey, mesh);
        allMeshes.push(mesh);
      } else {
        mesh = cached;
      }

      mesh.thinInstanceAdd(transform);
    }

    // Report progress and yield to the browser periodically so the UI can update
    const pct = Math.round(((i + 1) / totalElements) * 100);
    onProgress?.(pct);
    if (i % 20 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // All instances added — make meshes visible
  for (const mesh of allMeshes) {
    mesh.setEnabled(true);
  }

  ifcAPI.CloseModel(modelId);

  console.log(
    `IFC model loaded: ${allMeshes.length} unique meshes, ${flatMeshes.size()} elements`,
  );

  return {
    meshes: allMeshes,
    dispose() {
      for (const mesh of allMeshes) {
        mesh.dispose(false, false);
      }
      for (const mat of materialCache.values()) {
        mat.dispose();
      }
    },
  };
}
