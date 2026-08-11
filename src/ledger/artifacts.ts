import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Entry, entryFromYaml, entryToYaml } from "../entry.js";

/**
 * Artifacts are provenance, not the ledger.
 * Each run persists its entry, keyed by merge SHA, immutable and uncorrected.
 * They expire, so the release PR snapshot is authoritative for reads.
 */

const FILE_NAME = "entry.yml";

export function artifactName(sha: string): string {
  return `onegai-entry-${sha}`;
}

export function serializeEntryArtifact(entry: Entry): string {
  return entryToYaml(entry);
}

export function parseEntryArtifact(content: string): Entry {
  return entryFromYaml(content);
}

/** Minimal surface of `@actions/artifact` that we depend on. */
export interface ArtifactClient {
  uploadArtifact(
    name: string,
    files: string[],
    rootDirectory: string,
    options?: unknown,
  ): Promise<{ id?: number }>;
  getArtifact(name: string): Promise<{ artifact: { id: number } }>;
  downloadArtifact(id: number, options?: { path?: string }): Promise<{ downloadPath?: string }>;
}

export async function uploadEntryArtifact(
  client: ArtifactClient,
  entry: Entry,
  sha: string,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "onegai-artifact-"));
  const path = join(dir, FILE_NAME);
  writeFileSync(path, serializeEntryArtifact(entry), "utf8");
  await client.uploadArtifact(artifactName(sha), [path], dir);
}

/** Returns null when the artifact is absent. */
export async function downloadEntryArtifact(
  client: ArtifactClient,
  sha: string,
): Promise<Entry | null> {
  let id: number;
  try {
    const found = await client.getArtifact(artifactName(sha));
    id = found.artifact.id;
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), "onegai-artifact-"));
  const result = await client.downloadArtifact(id, { path: dir });
  const base = result.downloadPath ?? dir;
  const content = readFileSync(join(base, FILE_NAME), "utf8");
  return parseEntryArtifact(content);
}
