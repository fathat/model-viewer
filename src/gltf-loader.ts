import {
  type Scene,
  AbstractMesh,
  Mesh,
  SceneLoader,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { LoadedModel, MeshEntry } from "./model-types";

const MIN_OCCLUSION_VOLUME = 2.0;

export async function loadGltfModel(
  scene: Scene,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<LoadedModel> {
  const blobUrl = URL.createObjectURL(file);
  const ext = file.name.endsWith(".glb") ? ".glb" : ".gltf";

  try {
    const result = await SceneLoader.ImportMeshAsync(
      "",
      "",
      blobUrl,
      scene,
      (event) => {
        if (event.lengthComputable && event.total > 0) {
          const pct = Math.round((event.loaded / event.total) * 100);
          onProgress?.(pct);
        }
      },
      ext,
    );

    const entries: MeshEntry[] = [];

    for (const abstractMesh of result.meshes) {
      if (!(abstractMesh instanceof Mesh)) continue;
      if (abstractMesh.getTotalVertices() === 0) continue;

      abstractMesh.freezeWorldMatrix();
      abstractMesh.doNotSyncBoundingInfo = true;

      const bb = abstractMesh.getBoundingInfo().boundingBox;
      const extent = bb.maximum.subtract(bb.minimum);
      const volume = Math.abs(extent.x * extent.y * extent.z);
      const occlusionType =
        volume >= MIN_OCCLUSION_VOLUME
          ? AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC
          : AbstractMesh.OCCLUSION_TYPE_NONE;
      abstractMesh.occlusionType = occlusionType;

      entries.push({
        mesh: abstractMesh,
        originalOcclusionType: occlusionType,
      });
    }

    // Freeze materials for performance
    for (const mat of scene.materials) {
      mat.freeze();
    }

    const totalVertices = entries.reduce(
      (sum, e) => sum + e.mesh.getTotalVertices(),
      0,
    );
    console.log(
      `GLTF model loaded: ${entries.length} meshes, ${totalVertices} total vertices`,
    );

    return {
      entries,
      dispose() {
        for (const entry of entries) {
          entry.mesh.dispose(false, true);
        }
      },
    };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
