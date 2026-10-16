import assert from "node:assert/strict";
import { normalizeScheduledMergeIntervalSeconds } from "../src/scheduledMerge";

describe("scheduled merge interval", () => {
  it("defaults to five seconds", () => {
    assert.equal(normalizeScheduledMergeIntervalSeconds(undefined), 5);
    assert.equal(normalizeScheduledMergeIntervalSeconds(null), 5);
  });

  it("retains supported intervals and the disabled setting", () => {
    for (const seconds of [-1, 5, 15, 60, 300]) {
      assert.equal(normalizeScheduledMergeIntervalSeconds(seconds), seconds);
    }
  });

  it("rejects malformed or excessively frequent intervals", () => {
    assert.equal(normalizeScheduledMergeIntervalSeconds(0), 5);
    assert.equal(normalizeScheduledMergeIntervalSeconds(1), 5);
    assert.equal(normalizeScheduledMergeIntervalSeconds("5"), 5);
  });
});
