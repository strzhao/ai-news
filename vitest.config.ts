import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests-ts/**/*.test.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["lib/**", "app/**"],
      exclude: ["node_modules", ".next"],
    },
  },
});
