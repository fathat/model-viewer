import styles from "./ScenePage.module.css";

/**
 * Display stats overlay. (FPS, frame time, etc.)
 *
 * @param props
 * @constructor
 */
export function StatsDisplay(props: {
  stats: {
    fps: number;
    frameTime: number;
    renderTime: number;
    active: number;
    total: number;
    triangles: number;
  } | null;
  loadingState: "extracting" | number | null;
}) {
  return (
    <>
      {props.stats && (
        <div className={styles.statsOverlay}>
          <div style={{ display: "flex", gap: 16 }}>
            <span>FPS: {props.stats.fps}</span>
            <span>Frame: {props.stats.frameTime}ms</span>
            <span>Render: {props.stats.renderTime}ms</span>
            <span>
              Active: {props.stats.active} / {props.stats.total}
            </span>
            <span>Triangles: {props.stats.triangles.toLocaleString()}</span>
          </div>
          {props.loadingState != null && (
            <span className={styles.statsLoadingNote}>
              Model loading will affect performance
            </span>
          )}
        </div>
      )}
    </>
  );
}
