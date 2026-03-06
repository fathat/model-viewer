import { Scene } from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent";
import styles from "./ScenePage.module.css";
import {
  type IfcCategoryInfo,
  loadIfcModel,
  mergeLoadedModel,
} from "./loaders/ifc-loader.ts";
import { loadGltfModel } from "./loaders/gltf-loader.ts";
import type { LoadedModel } from "./model-types";
import { useCallback, useEffect, useRef, useState } from "react";

import grasslandsSunsetUrl from "./assets/backgrounds/grasslands_sunset_2k.hdr?url";
import rosendalPlainsUrl from "./assets/backgrounds/rosendal_plains_2_2k.hdr?url";
import sunnyRoseGardenUrl from "./assets/backgrounds/sunny_rose_garden_2k.hdr?url";

import { type CameraMode, SceneManager } from "./scene-manager.ts";
import { StatsDisplay } from "./StatsDisplay.tsx";

interface IfcCategoryState extends IfcCategoryInfo {
  visible: boolean;
}

const BACKGROUNDS: { label: string; url: string | null }[] = [
  { label: "None", url: null },
  { label: "Grasslands Sunset", url: grasslandsSunsetUrl },
  { label: "Rosendal Plains", url: rosendalPlainsUrl },
  { label: "Sunny Rose Garden", url: sunnyRoseGardenUrl },
];

export function ScenePage() {
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const loadedModelRef = useRef<LoadedModel | null>(null);
  const loadingRef = useRef(false);
  const [loadingState, setLoadingState] = useState<
    null | "extracting" | number
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ifcCategories, setIfcCategories] = useState<IfcCategoryState[]>([]);

  const [stats, setStats] = useState<{
    fps: number;
    frameTime: number;
    renderTime: number;
    active: number;
    total: number;
    triangles: number;
  } | null>(null);

  // Poll scene stats whenever the scene is ready.
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    const mgr = sceneManagerRef.current;
    if (!sceneReady || !mgr) {
      setStats(null);
      return;
    }
    const id = setInterval(() => {
      const scene = mgr.scene;
      const inst = mgr.instrumentation;
      let triangles = 0;
      for (const mesh of scene.meshes) {
        const indices = mesh.getTotalIndices();
        if (indices > 0) triangles += indices / 3;
      }
      setStats({
        fps: Math.round(scene.getEngine().getFps()),
        frameTime: +inst.frameTimeCounter.lastSecAverage.toFixed(1),
        renderTime: +inst.renderTimeCounter.lastSecAverage.toFixed(1),
        active: scene.getActiveMeshes().length,
        total: scene.meshes.length,
        triangles,
      });
    }, 500);
    return () => clearInterval(id);
  }, [sceneReady]);

  const toggleCategory = useCallback((label: string, visible: boolean) => {
    const model = loadedModelRef.current;
    if (!model) return;
    for (const entry of model.entries) {
      if (entry.meta?.ifcTypeLabel === label) {
        entry.mesh.setEnabled(visible);
      }
    }
    setIfcCategories((prev) =>
      prev.map((c) => (c.label === label ? { ...c, visible } : c)),
    );
  }, []);

  const onSceneReady = (scene: Scene) => {
    sceneManagerRef.current = new SceneManager(scene);
    setSceneReady(true);
  };

  const onRender = () => {
    sceneManagerRef.current?.onRender();
  };

  const isLoading = loadingState != null;

  const handleFile = useCallback(async (file: File) => {
    if (loadingRef.current) return;

    const mgr = sceneManagerRef.current;
    if (!mgr) {
      console.error("SceneManager not initialized yet -- cannot load model");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isGltf = ext === "gltf" || ext === "glb";
    if (!isGltf && ext !== "ifc") return;

    // Dispose previous model if any
    loadedModelRef.current?.dispose();

    // Remove placeholder geometry
    mgr.clearPlaceholder();

    loadingRef.current = true;
    setLoadingState("extracting");
    setLoadError(null);
    try {
      if (isGltf) {
        setIfcCategories([]);
        const model = await loadGltfModel(mgr.scene, file, setLoadingState);
        loadedModelRef.current = model;
        mgr.loadedModel = model;
      } else {
        const buffer = await file.arrayBuffer();
        const rawModel = await loadIfcModel(
          mgr.scene,
          new Uint8Array(buffer),
          setLoadingState,
          (cats) =>
            setIfcCategories((prev) =>
              cats.map((c) => ({
                ...c,
                visible: prev.find((p) => p.label === c.label)?.visible ?? true,
              })),
            ),
        );
        const model = mergeLoadedModel(rawModel, mgr.scene);
        loadedModelRef.current = model;
        mgr.loadedModel = model;
      }
      mgr.frameBoundingBox();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Failed to load model:", err);
      setLoadError(msg);
    } finally {
      loadingRef.current = false;
      setLoadingState(null);
    }
  }, []);

  const cameraModeRef = useRef<HTMLSelectElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onLoadClicked = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ifc,.gltf,.glb";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleFile(file);
    };
    input.click();
  };

  const onResetCameraClicked = () => {
    const mgr = sceneManagerRef.current;
    if (!mgr) return;
    mgr.setCameraMode("orbit");
    if (cameraModeRef.current) cameraModeRef.current.value = "orbit";
    mgr.frameBoundingBox();
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div className={styles.toolbar}>
        <button
          className={styles.toolbarButton}
          disabled={isLoading}
          onClick={onLoadClicked}
        >
          Load Model
        </button>
        <button
          className={styles.toolbarButton}
          disabled={isLoading}
          onClick={onResetCameraClicked}
        >
          Reset Camera
        </button>
        <select
          ref={cameraModeRef}
          className={styles.toolbarSelect}
          defaultValue="orbit"
          disabled={isLoading}
          onChange={(e) => {
            sceneManagerRef.current?.setCameraMode(
              e.target.value as CameraMode,
            );
          }}
        >
          <option value="orbit">Orbit</option>
          <option value="free">Free</option>
        </select>
        <select
          className={styles.toolbarSelect}
          disabled={isLoading}
          onChange={(e) => {
            const bg = BACKGROUNDS[Number(e.target.value)];
            sceneManagerRef.current?.setEnvironment(bg.url);
          }}
        >
          {BACKGROUNDS.map((bg, i) => (
            <option key={bg.label} value={i}>
              {bg.label}
            </option>
          ))}
        </select>
        <label className={styles.toolbarLabel}>
          <input
            type="checkbox"
            disabled={isLoading}
            onChange={(e) =>
              sceneManagerRef.current?.setSsaoEnabled(e.target.checked)
            }
          />
          Ambient Occlusion
        </label>
        <label className={styles.toolbarLabel}>
          <input
            type="checkbox"
            defaultChecked
            disabled={isLoading}
            onChange={(e) =>
              sceneManagerRef.current?.setOcclusionEnabled(e.target.checked)
            }
          />
          Occlusion Culling
        </label>
        <label className={styles.toolbarLabel}>
          <input
            type="checkbox"
            defaultChecked
            disabled={isLoading}
            onChange={(e) =>
              sceneManagerRef.current?.setBackfaceCulling(e.target.checked)
            }
          />
          Backface Culling
        </label>
        <select
          className={styles.toolbarSelect}
          defaultValue={String(window.devicePixelRatio)}
          disabled={isLoading}
          onChange={(e) => {
            const engine = sceneManagerRef.current?.scene.getEngine();
            if (engine) {
              engine.setHardwareScalingLevel(1 / Number(e.target.value));
            }
          }}
        >
          <option value="1">1x</option>
          <option value={String(window.devicePixelRatio)}>
            {window.devicePixelRatio}x (Retina)
          </option>
        </select>
      </div>
      <SceneComponent
        antialias
        onSceneReady={onSceneReady}
        onRender={onRender}
      />
      <div
        className={`${styles.overlay} ${loadingState === "extracting" ? styles.visible : ""}`}
      >
        Loading…
      </div>
      <div
        className={`${styles.progressPill} ${typeof loadingState === "number" ? styles.visible : ""}`}
      >
        Loading… {typeof loadingState === "number" ? loadingState : 0}%
      </div>
      {loadError && (
        <div
          className={styles.errorPill}
          title="Click to dismiss"
          onClick={() => setLoadError(null)}
        >
          Failed to load model: {loadError}
        </div>
      )}
      {ifcCategories.length > 0 && (
        <div className={styles.filterPanel}>
          <div className={styles.filterHeader}>Categories</div>
          {ifcCategories.map((cat) => (
            <label key={cat.label} className={styles.filterItem}>
              <input
                type="checkbox"
                checked={cat.visible}
                onChange={(e) => toggleCategory(cat.label, e.target.checked)}
              />
              {cat.label} ({cat.count})
            </label>
          ))}
        </div>
      )}
      <StatsDisplay stats={stats} loadingState={loadingState} />
      {dragging && (
        <div className={styles.dropOverlay}>Drop model file here</div>
      )}
    </div>
  );
}
