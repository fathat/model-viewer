import {
  AbstractMesh,
  ArcRotateCamera,
  type BaseTexture,
  type Camera,
  FreeCamera,
  HDRCubeTexture,
  HemisphericLight,
  PBRMetallicRoughnessMaterial,
  PositionGizmo,
  Scene,
  SceneInstrumentation,
  SSAO2RenderingPipeline,
  TransformNode,
  UtilityLayerRenderer,
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
  private gizmo: PositionGizmo | null;
  private gizmoAnchor: TransformNode | null;
  private gizmoLayer: UtilityLayerRenderer | null;
  private _cameraMode: CameraMode = "orbit";
  private light: HemisphericLight;
  private envTexture: BaseTexture | null = null;
  private skybox: AbstractMesh | null = null;
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

    // Axis marker gizmo at the origin
    this.gizmoLayer = new UtilityLayerRenderer(scene);
    this.gizmoAnchor = new TransformNode("gizmo-anchor", scene);
    this.gizmo = new PositionGizmo(this.gizmoLayer);
    this.gizmo.attachedNode = this.gizmoAnchor;
    for (const axis of [this.gizmo.xGizmo, this.gizmo.yGizmo, this.gizmo.zGizmo]) {
      axis.dragBehavior.onDragObservable.add(() => {
        this.gizmoAnchor!.position.setAll(0);
      });
    }

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

  setBackfaceCulling(enabled: boolean) {
    for (const mesh of this.scene.meshes) {
      const mat = mesh.material;
      if (mat && "backFaceCulling" in mat) {
        (mat as PBRMetallicRoughnessMaterial).backFaceCulling = enabled;
      }
    }
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
    this.gizmo?.dispose();
    this.gizmo = null;
    this.gizmoAnchor?.dispose();
    this.gizmoAnchor = null;
    this.gizmoLayer?.dispose();
    this.gizmoLayer = null;
  }

  onRender() {}

}
