import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const npmCli = process.env.npm_execpath;
const legacyName = ["c", "c", "switch"].join("");
const legacyPattern = new RegExp(
  `${legacyName.slice(0, 2)}[\\s_-]*${legacyName.slice(2)}`,
  "giu",
);

if (!npmCli) {
  throw new Error("Run this check through its npm script");
}

const packDirectory = await mkdtemp(join(tmpdir(), "khapiman-package-"));

try {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      npmCli,
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const [manifest] = JSON.parse(stdout);

  if (
    !manifest ||
    typeof manifest.filename !== "string" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("npm pack did not return a package file manifest");
  }

  for (const entry of manifest.files) {
    legacyPattern.lastIndex = 0;
    if (legacyPattern.test(String(entry.path ?? ""))) {
      throw new Error(
        "npm package contains a prohibited legacy brand in a path",
      );
    }
  }

  const archive = await readFile(join(packDirectory, manifest.filename));
  const unpackedArchive = gunzipSync(archive).toString("utf8");
  legacyPattern.lastIndex = 0;
  if (legacyPattern.test(unpackedArchive)) {
    throw new Error("npm package contains prohibited legacy branding");
  }

  process.stdout.write(
    `Checked ${manifest.files.length} files in the packed npm archive for prohibited legacy branding.\n`,
  );
} finally {
  await rm(packDirectory, { recursive: true, force: true });
}
