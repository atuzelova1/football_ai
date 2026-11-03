import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    testTimeout: 60000,
    hookTimeout: 20000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
