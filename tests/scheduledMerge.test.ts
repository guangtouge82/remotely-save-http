import assert from "node:assert/strict";
import { normalizeScheduledMergeInterval } from "../src/scheduledMerge";

describe("scheduled merge interval", () => {
  it("defaults existing installations to five minutes", () => {
    assert.equal(normalizeScheduledMergeInterval(undefined), 5);
    assert.equal(normalizeScheduledMergeInterval(null), 5);
  });

  it("retains supported intervals and the disabled setting", () => {
    for (const minutes of [-1, 1, 5, 10, 30]) {
      assert.equal(normalizeScheduledMergeInterval(minutes), minutes);
    }
  });

  it("rejects malformed or excessively frequent intervals", () => {
    assert.equal(normalizeScheduledMergeInterval(0), 5);
    assert.equal(normalizeScheduledMergeInterval(0.1), 5);
    assert.equal(normalizeScheduledMergeInterval("1"), 5);
  });
});
