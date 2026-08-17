import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  clean: true,
  dts: false,
  minify: false,
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
