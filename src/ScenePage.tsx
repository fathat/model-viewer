import {
  AbstractMesh,
  ArcRotateCamera,
  FreeCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
  HDRCubeTexture,
  type BaseTexture,
  type Camera,
  PBRMetallicRoughnessMaterial,
  Color3,
  SSAO2RenderingPipeline,
  SceneInstrumentation,
} from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent";
import "./App.css";
import styles from "./ScenePage.module.css";
import { loadIfcModel, mergeLoadedModel, type IfcCategoryInfo } from "./ifc-loader";
import { loadGltfModel } from "./gltf-loader";
import type { LoadedModel } from "./model-types";
import { useCallback, useEffect, useRef, useState } from "react";

interface IfcCategoryState extends IfcCategoryInfo {
  visible: boolean;
}

import grasslandsSunsetUrl from "./assets/backgrounds/grasslands_sunset_2k.hdr?url";
import rosendalPlainsUrl from "./assets/backgrounds/rosendal_plains_2_2k.hdr?url";
import sunnyRoseGardenUrl from "./assets/backgrounds/sunny_rose_garden_2k.hdr?url";

const BACKGROUNDS: { label: string; url: string | null }[] = [
  { label: "None", url: null },
  { label: "Grasslands Sunset", url: grasslandsSunsetUrl },
  { label: "Rosendal Plains", url: rosendalPlainsUrl },
  { label: "Sunny Rose Garden", url: sunnyRoseGardenUrl },
];

type CameraMode = "orbit" | "free";

class SceneManager {
  orbitCamera: ArcRotateCamera;
  freeCamera: FreeCamera;
  displayMesh: Mesh | null;
  ground: Mesh | null;
  private _cameraMode: CameraMode = "orbit";
  private light: HemisphericLight;
  private envTexture: BaseTexture | null = null;
  private skybox: Mesh | null = null;
  private ssaoPipeline: SSAO2RenderingPipeline | null = null;
  readonly instrumentation: SceneInstrumentation;

  get activeCamera(): Camera {
    return this._cameraMode === "orbit" ? this.orbitCamera : this.freeCamera;
  }

  constructor(public readonly scene: Scene) {
    const canvas = scene.getEngine().getRenderingCanvas();

    // Orbit camera (default)
    this.orbitCamera = new ArcRotateCamera(
      "orbitCamera",
      -Math.PI / 2,
      Math.PI / 3,
      20,
      Vector3.Zero(),
      scene,
    );
    this.orbitCamera.minZ = 0.1;
    this.orbitCamera.wheelDeltaPercentage = 0.01;
    this.orbitCamera.panningSensibility = 100;
    this.orbitCamera.attachControl(canvas, true);

    // Free camera (for interior navigation)
    this.freeCamera = new FreeCamera("freeCamera", new Vector3(0, 5, -10), scene);
    this.freeCamera.setTarget(Vector3.Zero());
    this.freeCamera.minZ = 0.1;

    scene.activeCamera = this.orbitCamera;

    this.light = new HemisphericLight(
      "light",
      new Vector3(0, 1, 0),
      this.scene,
    );
    this.light.intensity = 0.7;

    this.displayMesh = MeshBuilder.CreateBox("box", { size: 2 }, this.scene);
    this.displayMesh.position.y = 1;
    const boxMat = new PBRMetallicRoughnessMaterial("box-mat", this.scene);
    boxMat.baseColor = new Color3(0.8, 0.8, 0.8);
    boxMat.metallic = 0;
    boxMat.roughness = 0.8;
    this.displayMesh.material = boxMat;

    this.ground = MeshBuilder.CreateGround(
      "ground",
      { width: 6, height: 6 },
      this.scene,
    );
    const groundMat = new PBRMetallicRoughnessMaterial(
      "ground-mat",
      this.scene,
    );
    groundMat.baseColor = new Color3(0.5, 0.5, 0.5);
    groundMat.metallic = 0;
    groundMat.roughness = 1;
    this.ground.material = groundMat;

    scene.skipPointerMovePicking = true;

    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;
    this.instrumentation.captureRenderTime = true;
  }

  setEnvironment(url: string | null) {
    // Dispose previous environment
    this.skybox?.dispose();
    this.skybox = null;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.scene.environmentTexture = null;

    if (url) {
      const hdrTexture = new HDRCubeTexture(url, this.scene, 512);
      this.envTexture = hdrTexture;
      this.scene.environmentTexture = hdrTexture;
      this.skybox =
        this.scene.createDefaultSkybox(hdrTexture, true, 10000) ?? null;
      this.light.setEnabled(false);
      this._hasEnvironment = true;
    } else {
      this.light.setEnabled(true);
      this._hasEnvironment = false;
    }
    this._updateAutoClear();
  }

  private _hasEnvironment = false;

  /**
   * Resolve autoClearDepthAndStencil based on environment and SSAO state.
   * SSAO's pre-pass renderer requires a clean depth/stencil each frame, so
   * we must keep clearing enabled whenever SSAO is active.
   */
  private _updateAutoClear() {
    this.scene.autoClearDepthAndStencil =
      this._ssaoEnabled || !this._hasEnvironment;
  }

  setSsaoEnabled(enabled: boolean) {
    this._ssaoEnabled = enabled;
    this._applySsao();
  }

  private _ssaoEnabled = false;

  /** Create or destroy the SSAO pipeline to match _ssaoEnabled + active camera. */
  private _applySsao() {
    // Unfreeze materials so the pre-pass renderer can update shader defines
    for (const mat of this.scene.materials) {
      mat.unfreeze();
    }

    // Fully tear down old pipeline + pre-pass renderer to avoid stale state
    if (this.ssaoPipeline) {
      this.ssaoPipeline.dispose();
      this.ssaoPipeline = null;
    }
    this.scene.disablePrePassRenderer();

    if (this._ssaoEnabled) {
      this.scene.enablePrePassRenderer();
      const ssao = new SSAO2RenderingPipeline("ssao", this.scene, {
        ssaoRatio: 0.5,
        blurRatio: 1.0,
      });
      ssao.radius = 2;
      ssao.totalStrength = 1.0;
      ssao.samples = 16;
      ssao.expensiveBlur = true;
      this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
        "ssao",
        this.activeCamera,
      );
      this.ssaoPipeline = ssao;
    }

    // Re-freeze materials after pipeline reconfiguration
    for (const mat of this.scene.materials) {
      mat.freeze();
    }

    this._updateAutoClear();
  }

  setOcclusionEnabled(enabled: boolean) {
    const model = this._loadedModel;
    if (!model) return;
    for (const entry of model.entries) {
      entry.mesh.occlusionType = enabled
        ? entry.originalOcclusionType
        : AbstractMesh.OCCLUSION_TYPE_NONE;
    }
    this._occlusionEnabled = enabled;
  }

  /** Store a reference to the loaded model so occlusion can be toggled. */
  set loadedModel(model: LoadedModel | null) {
    this._loadedModel = model;
  }

  private _loadedModel: LoadedModel | null = null;
  // @ts-expect-error tracked for future use
  private _occlusionEnabled = true;

  setCameraMode(mode: CameraMode) {
    if (mode === this._cameraMode) return;
    const canvas = this.scene.getEngine().getRenderingCanvas();

    if (mode === "free") {
      // Transfer orbit camera state → free camera
      this.orbitCamera.detachControl();
      this.freeCamera.position = this.orbitCamera.position.clone();
      this.freeCamera.setTarget(this.orbitCamera.target.clone());
      this.freeCamera.attachControl(canvas, true);
      this.scene.activeCamera = this.freeCamera;
    } else {
      // Transfer free camera state → orbit camera
      this.freeCamera.detachControl();
      const forward = this.freeCamera.getForwardRay().direction;
      const target = this.freeCamera.position.add(forward.scale(this.orbitCamera.radius));
      this.orbitCamera.setTarget(target);
      this.orbitCamera.setPosition(this.freeCamera.position.clone());
      this.orbitCamera.attachControl(canvas, true);
      this.scene.activeCamera = this.orbitCamera;
    }

    this._cameraMode = mode;

    // Recreate SSAO pipeline for the new camera if it was enabled
    if (this._ssaoEnabled) {
      this._applySsao();
    }
  }

  frameBoundingBox() {
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    let found = false;

    for (const mesh of this.scene.meshes) {
      // Skip skybox, ground, and non-geometry meshes
      if (!mesh.isEnabled() || mesh.name === "ground" || mesh.name === "hdrSkyBox") continue;
      const bounds = mesh.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, bounds.minimumWorld);
      max = Vector3.Maximize(max, bounds.maximumWorld);
      found = true;
    }

    if (!found) return;

    const center = Vector3.Center(min, max);
    const extent = max.subtract(min);
    const diagonal = extent.length();

    this.orbitCamera.setTarget(center);
    this.orbitCamera.radius = diagonal * 1.5;
    this.orbitCamera.alpha = -Math.PI / 2;
    this.orbitCamera.beta = Math.PI / 3;
  }

  clearPlaceholder() {
    this.displayMesh?.dispose();
    this.displayMesh = null;
    this.ground?.dispose();
    this.ground = null;
  }

  onRender() {
    if (!this.displayMesh) return;

    const deltaTimeInMillis = this.scene.getEngine().getDeltaTime();
    const rpm = 10;
    this.displayMesh.rotation.y +=
      (rpm / 60) * Math.PI * 2 * (deltaTimeInMillis / 1000);
  }
}

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
                visible:
                  prev.find((p) => p.label === c.label)?.visible ?? true,
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
          className={styles.loadButton}
          disabled={isLoading}
          onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".ifc,.gltf,.glb";
            input.onchange = () => {
              const file = input.files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          Load Model
        </button>
        <select
          className={styles.envSelect}
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
          className={styles.envSelect}
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
        <label className={styles.ssaoLabel}>
          <input
            type="checkbox"
            disabled={isLoading}
            onChange={(e) =>
              sceneManagerRef.current?.setSsaoEnabled(e.target.checked)
            }
          />
          Ambient Occlusion
        </label>
        <label className={styles.ssaoLabel}>
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
        <select
          className={styles.envSelect}
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
      {stats && (
        <div className={styles.statsOverlay}>
          <div style={{ display: "flex", gap: 16 }}>
            <span>FPS: {stats.fps}</span>
            <span>Frame: {stats.frameTime}ms</span>
            <span>Render: {stats.renderTime}ms</span>
            <span>
              Active: {stats.active} / {stats.total}
            </span>
            <span>Triangles: {stats.triangles.toLocaleString()}</span>
          </div>
          {loadingState != null && (
            <span className={styles.statsLoadingNote}>
              Model loading will affect performance
            </span>
          )}
        </div>
      )}
      {dragging && (
        <div className={styles.dropOverlay}>
          Drop model file here
        </div>
      )}
    </div>
  );
}
