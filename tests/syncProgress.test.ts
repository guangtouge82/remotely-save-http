import assert from "node:assert/strict";
import {
  advanceSyncProgress,
  completeSyncProgress,
  progressForCompletedFiles,
  startSyncProgress,
} from "../src/syncProgress";

describe("sync progress", () => {
  it("advances through preparation without going backwards", () => {
    const started = startSyncProgress();
    assert.equal(started.percent, 0);
    const planned = advanceSyncProgress(started, 6);
    assert.equal(planned.percent, 17);
    assert.equal(advanceSyncProgress(planned, 3).percent, 17);
    assert.equal(advanceSyncProgress(planned, 7).percent, 20);
  });

  it("counts completed file operations and reserves 100% for success", () => {
    const transferring = advanceSyncProgress(startSyncProgress(), 7);
    assert.equal(progressForCompletedFiles(transferring, 0, 4).percent, 20);
    assert.equal(progressForCompletedFiles(transferring, 2, 4).percent, 57);
    assert.equal(progressForCompletedFiles(transferring, 4, 4).percent, 95);
    assert.equal(completeSyncProgress(transferring, true).percent, 100);
  });

  it("clamps invalid counts and never reports a failed run as complete", () => {
    const started = startSyncProgress();
    assert.equal(progressForCompletedFiles(started, 3, 0).percent, 20);
    assert.equal(progressForCompletedFiles(started, 99, 2).percent, 95);
    assert.equal(progressForCompletedFiles(started, -1, 2).percent, 20);
    const failed = completeSyncProgress(advanceSyncProgress(started, 5), false);
    assert.equal(failed.state, "error");
    assert.equal(failed.percent, 14);
  });
});
