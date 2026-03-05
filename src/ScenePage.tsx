import {
  FreeCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
} from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent";
import "./App.css";
import { loadIfcModel, type LoadedModel } from "./ifc-loader";
import { useRef, useState } from "react";

class SceneManager {
  camera: FreeCamera;
  displayMesh: Mesh | null;
  ground: Mesh | null;

  constructor(public readonly scene: Scene) {
    this.camera = new FreeCamera("camera1", new Vector3(0, 5, -10), scene);
    this.camera.setTarget(Vector3.Zero());

    const canvas = scene.getEngine().getRenderingCanvas();
    this.camera.attachControl(canvas, true);

    const light = new HemisphericLight(
      "light",
      new Vector3(0, 1, 0),
      this.scene,
    );
    light.intensity = 0.7;

    this.displayMesh = MeshBuilder.CreateBox("box", { size: 2 }, this.scene);
    this.displayMesh.position.y = 1;

    this.ground = MeshBuilder.CreateGround(
      "ground",
      { width: 6, height: 6 },
      this.scene,
    );
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
  const [loadingPct, setLoadingPct] = useState<number | null>(null);

  const onSceneReady = (scene: Scene) => {
    sceneManagerRef.current = new SceneManager(scene);
  };

  const onRender = () => {
    sceneManagerRef.current?.onRender();
  };

  return (
    <>
      <button
        style={{ position: "fixed", top: 16, left: 16, zIndex: 1 }}
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

            setLoadingPct(0);
            try {
              const buffer = await file.arrayBuffer();
              loadedModelRef.current = await loadIfcModel(
                mgr.scene,
                new Uint8Array(buffer),
                setLoadingPct,
              );
            } finally {
              setLoadingPct(null);
            }
          };
          input.click();
        }}
      >
        Load IFC Model
      </button>
      <SceneComponent
        antialias
        onSceneReady={onSceneReady}
        onRender={onRender}
      />
      {loadingPct !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            color: "white",
            fontSize: 24,
            zIndex: 2,
          }}
        >
          Loading… {loadingPct}%
        </div>
      )}
    </>
  );
}
