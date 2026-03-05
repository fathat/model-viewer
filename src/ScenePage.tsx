import {
  FreeCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  Mesh,
  Scene,
} from "@babylonjs/core";
import { SceneComponent } from "./SceneComponent"; // uses above component in same directory
import "./App.css";
import { loadIfcModel } from "./ifc-loader";
import { useRef } from "react";

class SceneManager {
  camera: FreeCamera;
  displayMesh: Mesh;

  constructor(private scene: Scene) {
    // This creates and positions a free camera (non-mesh)
    this.camera = new FreeCamera("camera1", new Vector3(0, 5, -10), this.scene);

    // This targets the camera to scene origin
    this.camera.setTarget(Vector3.Zero());

    const canvas = scene.getEngine().getRenderingCanvas();

    // This attaches the camera to the canvas
    this.camera.attachControl(canvas, true);

    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    const light = new HemisphericLight(
      "light",
      new Vector3(0, 1, 0),
      this.scene,
    );

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;

    // Our built-in 'box' shape.
    this.displayMesh = MeshBuilder.CreateBox("box", { size: 2 }, this.scene);

    // Move the box upward 1/2 its height
    this.displayMesh.position.y = 1;

    // Our built-in 'ground' shape.
    MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, this.scene);
  }

  onRender() {
    const deltaTimeInMillis = this.scene.getEngine().getDeltaTime();

    const rpm = 10;
    this.displayMesh.rotation.y +=
      (rpm / 60) * Math.PI * 2 * (deltaTimeInMillis / 1000);
  }
}

export function ScenePage() {
  const sceneMangerRef = useRef<SceneManager | null>(null);

  const onSceneReady = (scene: Scene) => {
    sceneMangerRef.current = new SceneManager(scene);
  };

  const onRender = () => {
    sceneMangerRef.current?.onRender();
  };

  return (
    <>
      <button
        style={{ position: "fixed", top: 16, left: 16, zIndex: 1 }}
        onClick={() => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".ifc";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const buffer = await file.arrayBuffer();
            loadIfcModel(new Uint8Array(buffer));
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
    </>
  );
}
