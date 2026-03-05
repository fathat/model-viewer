import type { Mesh } from "@babylonjs/core";

export interface IfcMeta {
  ifcType: number;
  ifcTypeLabel: string;
  priority: 1 | 2 | 3;
}

export interface MeshEntry {
  mesh: Mesh;
  /** Present only for IFC models */
  meta?: IfcMeta;
  /** Present only for IFC models */
  expressIDs?: number[];
  /** The occlusion type assigned at load time, used to restore after toggling */
  originalOcclusionType: number;
}

export interface LoadedModel {
  entries: MeshEntry[];
  dispose(): void;
}
