import { defineConfig } from "vite";

// Static build for GitHub Pages: relative asset paths (base "./"), so the site works under
// any repository path. Local preview binds to 127.0.0.1 only (no public port).
export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: false, fs: { allow: [".."] } },
  preview: { host: "127.0.0.1", port: 4173, strictPort: false },
  worker: { format: "es" },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // bench.html: an optional page that times the engine in the visitor's browser
    rollupOptions: { input: { main: "index.html", bench: "bench.html" } },
  },
});
