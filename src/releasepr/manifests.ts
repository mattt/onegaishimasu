import { PackageJson } from "release-please/build/src/updaters/node/package-json";
import { PackageLockJson } from "release-please/build/src/updaters/node/package-lock-json";
import type { Updater } from "release-please/build/src/update";
import { setLogger } from "release-please/build/src/util/logger";
import { Version } from "release-please/build/src/version";

// release-please's updaters narrate to a global logger; keep them quiet.
const NOOP = () => {};
setLogger({ error: NOOP, warn: NOOP, info: NOOP, debug: NOOP, trace: NOOP } as never);

export interface ManifestFile {
  path: string;
  content: string;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The seam to reimplement behind if the dependency ever chafes; null when unknown. */
function updaterFor(path: string, version: Version): Updater | null {
  switch (basename(path)) {
    case "package.json":
      return new PackageJson({ version });
    case "package-lock.json":
    case "npm-shrinkwrap.json":
      return new PackageLockJson({ version });
    default:
      return null;
  }
}

/**
 * Rewrite version manifests using release-please's updaters, which encode years of version-file handling.
 * Files we cannot update are returned unchanged.
 */
export function updateManifests(files: ManifestFile[], version: string): ManifestFile[] {
  const parsed = Version.parse(version);
  return files.map((file) => {
    const updater = updaterFor(file.path, parsed);
    if (!updater) return file;
    return { path: file.path, content: updater.updateContent(file.content) };
  });
}
