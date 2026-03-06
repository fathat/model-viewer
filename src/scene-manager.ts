import {
  AbstractMesh,
  ArcRotateCamera,
  type BaseTexture,
  type Camera,
  Color3,
  FreeCamera,
  HDRCubeTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMetallicRoughnessMaterial,
  Scene,
  SceneInstrumentation,
  SSAO2RenderingPipeline,
  Vector3,
} from "@babylonjs/core";
import type { LoadedModel } from "./model-types.ts";

/**
 * The camera mode determines which camera is active in the scene.
 * - "orbit" uses an ArcRotateCamera to orbit around the scene.
 * - "free" uses a FreeCamera to navigate around the scene, like a first-person camera.
 */
export type CameraMode = "orbit" | "free";

/**
 * This manages the non-react aspects of managing the Babylon.js scene.
 */
export class SceneManager {
  private orbitCamera: ArcRotateCamera;
  private freeCamera: FreeCamera;
  private displayMesh: Mesh | null;
  private ground: Mesh | null;
  private _cameraMode: CameraMode = "orbit";
  private light: HemisphericLight;
  private envTexture: BaseTexture | null = null;
  private skybox: Mesh | null = null;
  private ssaoPipeline: SSAO2RenderingPipeline | null = null;
  readonly instrumentation: SceneInstrumentation;

  private _loadedModel: LoadedModel | null = null;

  occlusionEnabled = true;

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
    this.freeCamera = new FreeCamera(
      "freeCamera",
      new Vector3(0, 5, -10),
      scene,
    );
    this.freeCamera.setTarget(Vector3.Zero());
    this.freeCamera.minZ = 0.1;
    this.freeCamera.keysUp.push(87); // W
    this.freeCamera.keysDown.push(83); // S
    this.freeCamera.keysLeft.push(65); // A
    this.freeCamera.keysRight.push(68); // D

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
    this.occlusionEnabled = enabled;
  }

  /** Store a reference to the loaded model so occlusion can be toggled. */
  set loadedModel(model: LoadedModel | null) {
    this._loadedModel = model;
  }

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
      const target = this.freeCamera.position.add(
        forward.scale(this.orbitCamera.radius),
      );
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
      if (
        !mesh.isEnabled() ||
        mesh.name === "ground" ||
        mesh.name === "hdrSkyBox"
      )
        continue;
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
