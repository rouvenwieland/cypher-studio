import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((env) =>
  mergeConfig(viteConfig(env as never), {
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test-setup.ts"],
      css: false,
      coverage: {
        provider: "v8",
        include: ["src/ipc/**", "src/i18n/**", "src/features/*/engine/**", "src/lib/**"],
        exclude: ["src/ipc/mock/**", "src/ipc/generated/**", "**/*.test.ts"],
        reporter: ["text-summary", "json-summary"],
      },
    },
  }),
);
