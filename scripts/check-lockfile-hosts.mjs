import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const packageMetadata = JSON.parse(await readFile("package.json", "utf8"));
const lockfile = JSON.parse(await readFile("package-lock.json", "utf8"));
const foreignUrls = new Set();

function inspect(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspect(item);
    return;
  }
  if (!value || typeof value !== "object") return;

  if (typeof value.resolved === "string") {
    const url = new URL(value.resolved);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
      foreignUrls.add(value.resolved);
    }
  }
  for (const child of Object.values(value)) inspect(child);
}

inspect(lockfile);

if (
  lockfile.name !== packageMetadata.name ||
  lockfile.version !== packageMetadata.version
) {
  throw new Error("package-lock.json name/version does not match package.json");
}
if (foreignUrls.size > 0) {
  throw new Error(
    `package-lock.json contains non-registry.npmjs.org sources:\n${[
      ...foreignUrls,
    ].join("\n")}`,
  );
}

process.stdout.write(
  "package-lock.json uses registry.npmjs.org exclusively.\n",
);
