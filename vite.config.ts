/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "/live/",
  plugins: [react()],
  server: {
    allowedHosts: ["127.0.0.1", "localhost"],
    host: "127.0.0.1",
    port: 5173,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.test.{ts,tsx}"],
    maxWorkers: 4,
  },
});
