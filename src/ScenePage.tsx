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
} from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent";
import "./App.css";
import styles from "./ScenePage.module.css";
import { loadIfcModel, type LoadedModel } from "./ifc-loader";
import { useRef, useState } from "react";

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
    const groundMat = new PBRMetallicRoughnessMaterial("ground-mat", this.scene);
    groundMat.baseColor = new Color3(0.5, 0.5, 0.5);
    groundMat.metallic = 0;
    groundMat.roughness = 1;
    this.ground.material = groundMat;
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
    } else {
      this.light.setEnabled(true);
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
              loadedModelRef.current = await loadIfcModel(
                mgr.scene,
                new Uint8Array(buffer),
                setLoadingState,
              );
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
    </>
  );
}
