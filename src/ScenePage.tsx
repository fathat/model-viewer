import {
  FreeCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
  HDRCubeTexture,
  type BaseTexture,
  PBRMetallicRoughnessMaterial,
  Color3,
  SSAO2RenderingPipeline,
  SceneInstrumentation,
} from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent";
import "./App.css";
import styles from "./ScenePage.module.css";
import { loadIfcModel, mergeLoadedModel, type LoadedModel, type IfcCategoryInfo } from "./ifc-loader";
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

class SceneManager {
  camera: FreeCamera;
  displayMesh: Mesh | null;
  ground: Mesh | null;
  private light: HemisphericLight;
  private envTexture: BaseTexture | null = null;
  private skybox: Mesh | null = null;
  private ssaoPipeline: SSAO2RenderingPipeline | null = null;
  readonly instrumentation: SceneInstrumentation;

  constructor(public readonly scene: Scene) {
    this.camera = new FreeCamera("camera1", new Vector3(0, 5, -10), scene);
    this.camera.setTarget(Vector3.Zero());

    const canvas = scene.getEngine().getRenderingCanvas();
    this.camera.attachControl(canvas, true);

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
    scene.enablePrePassRenderer();

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
      this.scene.autoClearDepthAndStencil = false;
    } else {
      this.light.setEnabled(true);
      this.scene.autoClearDepthAndStencil = true;
    }
  }

  setSsaoEnabled(enabled: boolean) {
    // Unfreeze materials so the pre-pass renderer can update shader defines
    for (const mat of this.scene.materials) {
      mat.unfreeze();
    }

    if (enabled && !this.ssaoPipeline) {
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
        this.camera,
      );
      this.ssaoPipeline = ssao;
    } else if (!enabled && this.ssaoPipeline) {
      this.ssaoPipeline.dispose();
      this.ssaoPipeline = null;
    }

    // Re-freeze materials after pipeline reconfiguration
    for (const mat of this.scene.materials) {
      mat.freeze();
    }
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
  const [loadingState, setLoadingState] = useState<
    null | "extracting" | number
  >(null);
  const [ifcCategories, setIfcCategories] = useState<IfcCategoryState[]>([]);

  const [stats, setStats] = useState<{
    fps: number;
    frameTime: number;
    renderTime: number;
    active: number;
    total: number;
  } | null>(null);

  // Poll scene stats when a model is loaded.
  // Re-run when loadingState changes — the interval starts once loading finishes (null).
  useEffect(() => {
    const mgr = sceneManagerRef.current;
    if (!loadedModelRef.current || !mgr) {
      setStats(null);
      return;
    }
    const id = setInterval(() => {
      const scene = mgr.scene;
      const inst = mgr.instrumentation;
      setStats({
        fps: Math.round(scene.getEngine().getFps()),
        frameTime: +inst.frameTimeCounter.lastSecAverage.toFixed(1),
        renderTime: +inst.renderTimeCounter.lastSecAverage.toFixed(1),
        active: scene.getActiveMeshes().length,
        total: scene.meshes.length,
      });
    }, 500);
    return () => clearInterval(id);
  }, [loadingState]);

  const toggleCategory = useCallback((label: string, visible: boolean) => {
    const model = loadedModelRef.current;
    if (!model) return;
    for (const entry of model.entries) {
      if (entry.meta.ifcTypeLabel === label) {
        entry.mesh.setEnabled(visible);
      }
    }
    setIfcCategories((prev) =>
      prev.map((c) => (c.label === label ? { ...c, visible } : c)),
    );
  }, []);

  const onSceneReady = (scene: Scene) => {
    sceneManagerRef.current = new SceneManager(scene);
  };

  const onRender = () => {
    sceneManagerRef.current?.onRender();
  };

  return (
    <>
      <div className={styles.toolbar}>
        <button
          className={styles.loadButton}
          onClick={() => {
            const mgr = sceneManagerRef.current;
            if (!mgr) {
              console.error(
                "SceneManager not initialized yet -- cannot load IFC model",
              );
              return;
            }
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".ifc";
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;

              // Dispose previous IFC model if any
              loadedModelRef.current?.dispose();

              // Remove placeholder geometry
              mgr.clearPlaceholder();

              setLoadingState("extracting");
              try {
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
                          prev.find((p) => p.label === c.label)?.visible ??
                          true,
                      })),
                    ),
                );
                const model = mergeLoadedModel(rawModel, mgr.scene);
                loadedModelRef.current = model;
              } finally {
                setLoadingState(null);
              }
            };
            input.click();
          }}
        >
          Load IFC Model
        </button>
        <select
          className={styles.envSelect}
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
            onChange={(e) =>
              sceneManagerRef.current?.setSsaoEnabled(e.target.checked)
            }
          />
          SSAO
        </label>
        <select
          className={styles.envSelect}
          defaultValue={String(window.devicePixelRatio)}
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
          <span>FPS: {stats.fps}</span>
          <span>Frame: {stats.frameTime}ms</span>
          <span>Render: {stats.renderTime}ms</span>
          <span>
            Active: {stats.active} / {stats.total}
          </span>
        </div>
      )}
    </>
  );
}
