import { describe, expect, it } from "vite-plus/test";
import { parseConfig } from "../src/config.js";

describe("scaffold", () => {
  it("loads config defaults", () => {
    const config = parseConfig(null);
    expect(config.provider.type).toBe("copilot");
    expect(config.provider.model).toBe("auto");
    expect(config.releaseBranch).toBe("onegai--release");
    expect(config.diffBudget).toBeGreaterThan(0);
  });

  it("parses a partial config over defaults", () => {
    const config = parseConfig(
      "provider:\n  type: openai\n  model: gpt-5.6-terra\ndiffBudget: 5000\n",
    );
    expect(config.provider.type).toBe("openai");
    expect(config.provider.model).toBe("gpt-5.6-terra");
    expect(config.diffBudget).toBe(5000);
    expect(config.releaseBranch).toBe("onegai--release");
  });

  it("requires a model for BYO providers", () => {
    expect(() => parseConfig("provider:\n  type: openai\n")).toThrow(/provider\.model/);
  });
});
