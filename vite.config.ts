import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  fmt: {
    ignorePatterns: ["dist/**", "SPEC.md"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // Bundle the Action and CLI into self-contained CommonJS, deps inlined, so the
  // committed dist runs without an install step.
  pack: {
    entry: { index: "src/main.ts", cli: "src/cli.ts" },
    format: ["cjs"],
    platform: "node",
    target: "node20",
    deps: { alwaysBundle: [/.*/] },
    dts: false,
    clean: true,
    outDir: "dist",
  },
});
