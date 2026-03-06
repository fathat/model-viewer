import styles from "./SceneComponent.module.css";
import { useEffect, useRef } from "react";
import {
  Engine,
  Scene,
  type EngineOptions,
  type SceneOptions,
} from "@babylonjs/core";

export interface SceneComponentProps {
  antialias?: boolean;
  engineOptions?: EngineOptions;
  adaptToDeviceRatio?: boolean;
  sceneOptions?: SceneOptions;
  onRender: (scene: Scene) => void;
  onSceneReady: (scene: Scene) => void;
}

export function SceneComponent({
  antialias,
  engineOptions,
  adaptToDeviceRatio,
  sceneOptions,
  onRender,
  onSceneReady,
  ...rest
}: SceneComponentProps) {
  const reactCanvas = useRef(null);
  const onRenderRef = useRef(onRender);
  const onSceneReadyRef = useRef(onSceneReady);
  useEffect(() => {
    onRenderRef.current = onRender;
    onSceneReadyRef.current = onSceneReady;
  }, [onRender, onSceneReady]);

  // set up basic engine and scene
  useEffect(() => {
    const { current: canvas } = reactCanvas;

    if (!canvas) return;

    const engine = new Engine(
      canvas,
      antialias,
      engineOptions,
      adaptToDeviceRatio,
    );
    const scene = new Scene(engine, sceneOptions);
    if (scene.isReady()) {
      onSceneReadyRef.current(scene);
    } else {
      scene.onReadyObservable.addOnce((scene) =>
        onSceneReadyRef.current(scene),
      );
    }

    engine.runRenderLoop(() => {
      onRenderRef.current(scene);
      scene.render();
    });

    const resize = () => {
      scene.getEngine().resize();
    };

    if (window) {
      window.addEventListener("resize", resize);
    }

    return () => {
      scene.getEngine().dispose();

      if (window) {
        window.removeEventListener("resize", resize);
      }
    };
  }, [antialias, engineOptions, adaptToDeviceRatio, sceneOptions]);

  return <canvas className={styles.sceneCanvas} ref={reactCanvas} {...rest} />;
}
