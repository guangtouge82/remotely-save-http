import assert from "node:assert/strict";
import type { Entity, MixedEntity, RemotelySavePluginSettings } from "../../src/baseTypes";
import { getSyncPlanInplace } from "../src/sync";

const previous: Entity = {
  key: "note.md",
  keyRaw: "note.md",
  sizeRaw: 8,
  sizeEnc: 8,
  mtimeCli: 1000,
  mtimeSvr: 1000,
  etag: '"before"',
};
const remote: Entity = { ...previous, etag: '"after"' };
const settings = {
  serviceType: "webdav",
  password: "",
  concurrency: 5,
} as RemotelySavePluginSettings;

async function decisionFor(local: Entity | undefined) {
  const entry: MixedEntity = {
    key: "note.md",
    local,
    remote,
    prevSync: previous,
  };
  const plan = await getSyncPlanInplace(
    { "note.md": entry },
    -1,
    "smart_conflict",
    "bidirectional",
    undefined,
    settings,
    "auto",
    ".obsidian"
  );
  return plan["note.md"].decision;
}

describe("WebDAV ETag changes in the sync plan", () => {
  const originalWindow = globalThis.window;
  before(() => {
    (globalThis as any).window = {
      moment: (time: number) => ({ format: () => new Date(time).toISOString() }),
    };
  });
  after(() => {
    (globalThis as any).window = originalWindow;
  });

  it("pulls a server update with unchanged size and timestamp", async () => {
    assert.equal(await decisionFor({ ...previous, etag: undefined }), "remote_is_modified_then_pull");
  });

  it("merges when local and server both changed", async () => {
    assert.equal(
      await decisionFor({ ...previous, mtimeCli: 2000, mtimeSvr: 2000 }),
      "conflict_modified_then_smart_conflict"
    );
  });

  it("keeps a changed server file when the local file was deleted", async () => {
    assert.equal(await decisionFor(undefined), "remote_is_modified_then_pull");
  });

  it("plans both directions for newly added files", async () => {
    const newFile: Entity = {
      key: "new.md", keyRaw: "new.md", sizeRaw: 4, sizeEnc: 4,
      mtimeCli: 2000, mtimeSvr: 2000,
    };
    for (const [entry, expected] of [
      [{ key: "new.md", local: newFile }, "local_is_created_then_push"],
      [{ key: "new.md", remote: newFile }, "remote_is_created_then_pull"],
    ] as const) {
      const plan = await getSyncPlanInplace(
        { "new.md": entry }, -1, "smart_conflict", "bidirectional",
        undefined, settings, "auto", ".obsidian"
      );
      assert.equal(plan["new.md"].decision, expected);
    }
  });
});
