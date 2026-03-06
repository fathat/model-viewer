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
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>FPS: {props.stats.fps}</div>
            <div>Frame: {props.stats.frameTime}ms</div>
            <div>Render: {props.stats.renderTime}ms</div>
            <div>
              Active: {props.stats.active} / {props.stats.total}
            </div>
            <div>Triangles: {props.stats.triangles.toLocaleString()}</div>
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
