import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),

    // Add middleware to serve .wasm files with the correct MIME type.
    // We could use vite-plugin-wasm, but it's kind of overkill
    {
      name: "wasm-mime-type",
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
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
        });
      },
    },
  ],
})
