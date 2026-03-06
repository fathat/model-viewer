import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock web-ifc to avoid WASM loading in tests
vi.mock("web-ifc", () => ({
  IfcAPI: class {
    SetWasmPath() {}
  },
  IFCWALL: 1,
  IFCWALLSTANDARDCASE: 2,
  IFCROOF: 3,
  IFCSLAB: 4,
  IFCCURTAINWALL: 5,
  IFCWINDOW: 6,
  IFCDOOR: 7,
  IFCSTAIR: 8,
  IFCSTAIRFLIGHT: 9,
  IFCRAILING: 10,
  IFCBEAM: 11,
  IFCCOLUMN: 12,
  IFCFURNISHINGELEMENT: 13,
  IFCMEMBER: 14,
  IFCBUILDINGELEMENTPROXY: 15,
}));
vi.mock("web-ifc/web-ifc.wasm?url", () => ({ default: "/mock.wasm" }));

import {
  NullEngine,
  Scene,
  Mesh,
  VertexData,
  PBRMetallicRoughnessMaterial,
  AbstractMesh,
} from "@babylonjs/core";
import { mergeLoadedModel } from "./ifc-loader.ts";
import type { MeshEntry, LoadedModel } from "../model-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  engine.dispose();
});

/** Create a minimal single-triangle mesh. */
function tri(name: string, mat?: PBRMetallicRoughnessMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  vd.normals = [0, 0, 1, 0, 0, 1, 0, 0, 1];
  vd.indices = [0, 1, 2];
  vd.applyToMesh(mesh);
  if (mat) mesh.material = mat;
  return mesh;
}

function makeEntry(
  mesh: Mesh,
  opts: { label?: string; expressIDs?: number[] } = {},
): MeshEntry {
  return {
    mesh,
    meta: opts.label
      ? { ifcType: 1, ifcTypeLabel: opts.label, priority: 1 }
      : undefined,
    expressIDs: opts.expressIDs,
    originalOcclusionType: AbstractMesh.OCCLUSION_TYPE_NONE,
  };
}

function makeModel(entries: MeshEntry[]): LoadedModel {
  return {
    entries,
    dispose() {
      for (const e of entries) e.mesh.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// mergeLoadedModel
// ---------------------------------------------------------------------------

describe("mergeLoadedModel", () => {
  it("merges meshes that share the same material and category", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall" }),
      makeEntry(tri("b", mat), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries).toHaveLength(1);
  });

  it("keeps meshes with different materials separate", () => {
    const mat1 = new PBRMetallicRoughnessMaterial("m1", scene);
    const mat2 = new PBRMetallicRoughnessMaterial("m2", scene);
    const model = makeModel([
      makeEntry(tri("a", mat1), { label: "Wall" }),
      makeEntry(tri("b", mat2), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries).toHaveLength(2);
  });

  it("keeps meshes with different categories separate", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall" }),
      makeEntry(tri("b", mat), { label: "Slab" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries).toHaveLength(2);
  });

  // NullEngine lacks the Instanced Array extension, so thinInstanceAdd is a
  // no-op and thinInstanceCount stays 0.  We can still verify the threshold
  // logic by reaching into the internal counter that mergeLoadedModel reads.
  it("keeps high-instance-count meshes as-is (above threshold)", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const instanced = tri("instanced", mat);

    // Simulate 15 thin instances by poking the internal counter that
    // mergeLoadedModel checks via mesh.thinInstanceCount.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instanced as any)._thinInstanceDataStorage.instancesCount = 15;

    const model = makeModel([
      makeEntry(instanced, { label: "Wall" }),
      makeEntry(tri("other", mat), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene, 10);
    // Instanced mesh kept + single non-instanced mesh kept
    expect(merged.entries).toHaveLength(2);
  });

  it("accumulates expressIDs from merged meshes", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall", expressIDs: [100, 101] }),
      makeEntry(tri("b", mat), { label: "Wall", expressIDs: [200] }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries[0].expressIDs).toEqual(
      expect.arrayContaining([100, 101, 200]),
    );
  });

  it("preserves a single non-instanced mesh without merging", () => {
    const mat = new PBRMetallicRoughnessMaterial("solo", scene);
    const model = makeModel([makeEntry(tri("only", mat), { label: "Slab" })]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries).toHaveLength(1);
  });

  it("merged mesh has combined vertex count from source meshes", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall" }),
      makeEntry(tri("b", mat), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries).toHaveLength(1);
    // Two triangles (3 verts each) merged into one mesh
    expect(merged.entries[0].mesh.getTotalVertices()).toBe(6);
  });

  it("disables occlusion on merged meshes", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall" }),
      makeEntry(tri("b", mat), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    expect(merged.entries[0].mesh.occlusionType).toBe(
      AbstractMesh.OCCLUSION_TYPE_NONE,
    );
  });

  it("provides a working dispose function", () => {
    const mat = new PBRMetallicRoughnessMaterial("shared", scene);
    const model = makeModel([
      makeEntry(tri("a", mat), { label: "Wall" }),
      makeEntry(tri("b", mat), { label: "Wall" }),
    ]);

    const merged = mergeLoadedModel(model, scene);
    const meshName = merged.entries[0].mesh.name;

    merged.dispose();

    // The merged mesh should no longer be in the scene
    expect(scene.getMeshByName(meshName)).toBeNull();
  });
});
