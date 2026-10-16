import assert from "node:assert/strict";
import type { Entity } from "../src/baseTypes";
import {
  remoteEtagChanged,
  remoteMatchesPreviousVersion,
} from "../src/remoteVersion";

const previous: Entity = {
  key: "note.md",
  keyRaw: "note.md",
  sizeRaw: 12,
  sizeEnc: 12,
  mtimeSvr: 1000,
  etag: '"revision-a"',
};

describe("WebDAV remote version comparison", () => {
  it("detects a changed ETag even when time and size stay the same", () => {
    const remote = { ...previous, etag: '"revision-b"' };
    assert.equal(remoteMatchesPreviousVersion(previous, remote), false);
    assert.equal(remoteEtagChanged(previous, remote), true);
  });

  it("uses modified time and size when the server supplies no ETag", () => {
    const remote = { ...previous, etag: undefined };
    assert.equal(remoteMatchesPreviousVersion(previous, remote), true);
    assert.equal(remoteMatchesPreviousVersion(previous, { ...remote, mtimeSvr: 2000 }), false);
    assert.equal(remoteMatchesPreviousVersion(previous, { ...remote, sizeEnc: 13 }), false);
  });
});
