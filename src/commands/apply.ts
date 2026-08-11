import { type Entry, PINNABLE_FIELDS } from "../entry.js";
import { mergePinned } from "../ledger/pinning.js";
import type { Command } from "./parser.js";

export interface CommandOutcome {
  entry: Entry;
  /** The one command that reaches a model: re-run the pipeline for this PR. */
  reclassify: boolean;
}

/**
 * Field writes land verbatim and pin the field, so regeneration never overwrites the correction.
 * `pin` freezes every field; `reclassify` asks the caller to re-run the pipeline.
 */
export function applyCommand(entry: Entry, command: Command): CommandOutcome {
  switch (command.type) {
    case "set-kind":
      return { entry: mergePinned({ ...entry, kind: command.value }, ["kind"]), reclassify: false };
    case "set-summary":
      return {
        entry: mergePinned({ ...entry, summary: command.value }, ["summary"]),
        reclassify: false,
      };
    case "set-notes":
      return {
        entry: mergePinned({ ...entry, notes: command.value }, ["notes"]),
        reclassify: false,
      };
    case "pin":
      return { entry: mergePinned(entry, [...PINNABLE_FIELDS]), reclassify: false };
    case "reclassify":
      return { entry, reclassify: true };
    case "invalid":
      return { entry, reclassify: false };
  }
}
