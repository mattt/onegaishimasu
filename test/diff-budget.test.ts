import { describe, expect, it } from "vite-plus/test";
import { applyDiffBudget, splitDiff } from "../src/classify/diff-budget.js";

const diff = `diff --git a/src/client.ts b/src/client.ts
index 111..222 100644
--- a/src/client.ts
+++ b/src/client.ts
@@ -1,3 +1,5 @@
+export class RetryPolicy {}
 export class Client {}
diff --git a/package-lock.json b/package-lock.json
index 333..444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1000 +1,2000 @@
+lots of lockfile noise
diff --git a/package.json b/package.json
index 555..666 100644
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
-  "version": "1.0.0"
+  "version": "1.1.0"
diff --git a/test/client.test.ts b/test/client.test.ts
index 777..888 100644
--- a/test/client.test.ts
+++ b/test/client.test.ts
@@ -1,1 +1,2 @@
+test noise
`;

describe("splitDiff", () => {
  it("splits into per-file chunks with paths", () => {
    const chunks = splitDiff(diff);
    expect(chunks.map((c) => c.path)).toEqual([
      "src/client.ts",
      "package-lock.json",
      "package.json",
      "test/client.test.ts",
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(splitDiff("")).toEqual([]);
  });
});

describe("applyDiffBudget", () => {
  it("excludes lockfiles", () => {
    const out = applyDiffBudget(diff, { maxChars: 10000 });
    expect(out).not.toContain("lockfile noise");
  });

  it("prioritizes manifests and API surface over tests", () => {
    const out = applyDiffBudget(diff, { maxChars: 10000 });
    const manifestIdx = out.indexOf("package.json");
    const apiIdx = out.indexOf("src/client.ts");
    const testIdx = out.indexOf("test/client.test.ts");
    expect(manifestIdx).toBeLessThan(testIdx);
    expect(apiIdx).toBeLessThan(testIdx);
  });

  it("truncates and notes omissions under a tight budget", () => {
    const out = applyDiffBudget(diff, { maxChars: 120 });
    expect(out).toContain("omitted for budget");
  });
});
