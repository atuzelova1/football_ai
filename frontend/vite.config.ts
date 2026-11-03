import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules") &&
            /recharts|d3-|react-smooth|decimal.js/.test(id)
          )
            return "charts";
          if (
            id.includes("node_modules") &&
            /react-dom|react-router|node_modules[\\/]react[\\/]/.test(id)
          )
            return "react";
        },
      },
    },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
  preview: {
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
  },
});
