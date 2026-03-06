import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Middleware to serve .wasm files with the correct MIME type.
const wasmMimeMiddleware: import("vite").Connect.NextHandleFunction = (
  _req,
  res,
  next,
) => {
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (
      name === "Content-Type" &&
      typeof value === "string" &&
      res.req?.url?.endsWith(".wasm")
    ) {
      return origSetHeader(name, "application/wasm");
    }
    return origSetHeader(name, value);
  };
  next();
};

// https://vite.dev/config/
export default defineConfig({
  base: process.env.CI ? "/model-viewer/" : "/",
  build: {
    rollupOptions: {
      output: {
        // Keep original filenames for .wasm assets (no content hash).
        // web-ifc's SetWasmPath only sets the directory and appends the
        // original filename internally, so hashed names break loading.
        assetFileNames: (assetInfo) =>
          assetInfo.names?.some((n) => n.endsWith(".wasm"))
            ? "assets/[name][extname]"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    react(),

    // We could use vite-plugin-wasm, but it's kind of overkill
    {
      name: "wasm-mime-type",
      configureServer(server) {
        server.middlewares.use(wasmMimeMiddleware);
      },
      configurePreviewServer(server) {
        server.middlewares.use(wasmMimeMiddleware);
      },
    },
  ],
});
