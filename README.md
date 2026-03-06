# LMV - IFC & GLTF Model Viewer

A web-based 3D model viewer for IFC and GLTF/GLB files, built with React, Babylon.js, and web-ifc. Designed for viewing large architectural and construction models with real-time performance optimizations.

## Features

- **IFC & GLTF/GLB support** — Load industry-standard BIM models (IFC) and general 3D models (GLTF/GLB) via file picker or drag-and-drop
- **Orbit & Free cameras** — Orbit camera for external viewing; free camera with WASD controls for interior navigation
- **IFC category filtering** — Toggle visibility of IFC element types (walls, doors, windows, beams, etc.) from a sidebar panel
- **HDR environments** — Choose from multiple HDR skyboxes (Grasslands Sunset, Rosendal Plains, Sunny Rose Garden) for realistic lighting and reflections
- **SSAO** — Screen-space ambient occlusion post-processing for added depth
- **Performance optimizations** — Hardware instancing, mesh merging by material, occlusion culling, and frozen world matrices for smooth rendering of large models
- **Real-time stats** — FPS, frame time, render time, active/total mesh count, and triangle count overlay
- **DPI scaling** — Toggle between 1x and Retina rendering

## Tech Stack

- **React 19** + **TypeScript** — UI framework
- **Babylon.js** — WebGL rendering engine
- **web-ifc** — WASM-based IFC file parsing and geometry extraction
- **Vite** — Build tool and dev server

## Getting Started

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal. Click **Load Model** or drag and drop an `.ifc`, `.gltf`, or `.glb` file onto the viewer.

## Scripts

| Command           | Description                         |
| ----------------- | ----------------------------------- |
| `npm run dev`     | Start dev server with HMR           |
| `npm run build`   | Type-check and build for production |
| `npm run preview` | Preview the production build        |
| `npm run lint`    | Run ESLint                          |
| `npm run format`  | Format code with Prettier           |

## Project Structure

```
src/
├── main.tsx                 # React entry point
├── App.tsx                  # Root component
├── ScenePage.tsx            # Main UI: toolbar, panels, scene manager
├── SceneComponent.tsx       # Babylon.js engine/canvas wrapper
├── ifc-loader.ts            # IFC loading, instancing, and mesh merging
├── gltf-loader.ts           # GLTF/GLB loading and material merging
├── model-types.ts           # Shared TypeScript interfaces
└── assets/backgrounds/      # HDR environment maps
```
