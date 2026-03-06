import {
  type Scene,
  AbstractMesh,
  Mesh,
  ImportMeshAsync,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import type { LoadedModel, MeshEntry } from "./model-types";

const MIN_OCCLUSION_VOLUME = 2.0;

/**
 * Merge meshes by material to reduce draw calls.
 * Each material group becomes a single merged mesh.
 */
function mergeByMaterial(
  meshes: Mesh[],
): MeshEntry[] {
  // Group meshes by material
  const groups = new Map<number, Mesh[]>();
  for (const mesh of meshes) {
    const matId = mesh.material?.uniqueId ?? 0;
    let group = groups.get(matId);
    if (!group) {
      group = [];
      groups.set(matId, group);
    }
    group.push(mesh);
  }

  const entries: MeshEntry[] = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      // Single mesh — no merge needed
      const mesh = group[0];
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;

      const bb = mesh.getBoundingInfo().boundingBox;
      const extent = bb.maximum.subtract(bb.minimum);
      const volume = Math.abs(extent.x * extent.y * extent.z);
      const occlusionType =
        volume >= MIN_OCCLUSION_VOLUME
          ? AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC
          : AbstractMesh.OCCLUSION_TYPE_NONE;
      mesh.occlusionType = occlusionType;

      entries.push({ mesh, originalOcclusionType: occlusionType });
      continue;
    }

    // Merge all meshes in this material group
    const merged = Mesh.MergeMeshes(
      group,
      true,  // disposeSource
      true,  // allow32BitsIndices
      undefined,
      false, // subdivideWithSubMeshes
      true,  // multiMultiMaterials — keeps individual materials
    );

    if (!merged) {
      // Fallback: keep originals if merge fails
      for (const mesh of group) {
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
        mesh.occlusionType = AbstractMesh.OCCLUSION_TYPE_NONE;
        entries.push({ mesh, originalOcclusionType: AbstractMesh.OCCLUSION_TYPE_NONE });
      }
      continue;
    }

    merged.freezeWorldMatrix();
    merged.doNotSyncBoundingInfo = true;

    const bb = merged.getBoundingInfo().boundingBox;
    const extent = bb.maximum.subtract(bb.minimum);
    const volume = Math.abs(extent.x * extent.y * extent.z);
    const occlusionType =
      volume >= MIN_OCCLUSION_VOLUME
        ? AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC
        : AbstractMesh.OCCLUSION_TYPE_NONE;
    merged.occlusionType = occlusionType;

    entries.push({ mesh: merged, originalOcclusionType: occlusionType });
  }

  console.log(
    `Merged ${meshes.length} meshes into ${entries.length} by material (${groups.size} material groups)`,
  );

  return entries;
}

export async function loadGltfModel(
  scene: Scene,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<LoadedModel> {
  const blobUrl = URL.createObjectURL(file);
  const ext = file.name.endsWith(".glb") ? ".glb" : ".gltf";

  const result = await ImportMeshAsync(blobUrl, scene, {
    pluginExtension: ext,
    onProgress: (event) => {
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.round((event.loaded / event.total) * 100);
        onProgress?.(pct);
      }
    },
  });

  // Collect meshes with actual geometry
  const geometryMeshes: Mesh[] = [];
  const emptyNodes: AbstractMesh[] = [];
  for (const abstractMesh of result.meshes) {
    if (
      !(abstractMesh instanceof Mesh) ||
      abstractMesh.getTotalVertices() === 0
    ) {
      emptyNodes.push(abstractMesh);
      continue;
    }
    geometryMeshes.push(abstractMesh);
  }

  // Merge meshes by material to minimize draw calls
  const entries = mergeByMaterial(geometryMeshes);

  // Disable truly empty nodes (no children) so they don't contribute to active mesh count
  for (const node of emptyNodes) {
    if (node.getChildMeshes(false).length === 0) {
      node.setEnabled(false);
    }
  }

  // Freeze materials for performance (wait a frame to let textures finish loading)
  await new Promise((r) => setTimeout(r, 0));
  for (const mat of scene.materials) {
    mat.freeze();
  }

  // Revoke blob URL after textures have had time to load
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

  const totalVertices = entries.reduce(
    (sum, e) => sum + e.mesh.getTotalVertices(),
    0,
  );
  console.log(
    `GLTF model loaded: ${entries.length} meshes, ` +
      `${totalVertices} total vertices, ${emptyNodes.length} empty nodes disabled`,
  );

  return {
    entries,
    dispose() {
      for (const entry of entries) {
        entry.mesh.dispose(false, true);
      }
    },
  };
}
