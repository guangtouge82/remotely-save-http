import { strict as assert } from "assert";
import {
  MAX_IN_MEMORY_SYNC_FILE_SIZE,
  checkIsSkipItemOrNotByName,
  excludeOversizedFiles,
} from "../src/sync";

describe("Sync: large file safety", () => {
  it("leaves a large file out of all three snapshots while keeping normal new files", () => {
    const large = { key: "health/export.xml", keyRaw: "health/export.xml", sizeRaw: MAX_IN_MEMORY_SYNC_FILE_SIZE + 1 };
    const normal = { key: "new.md", keyRaw: "new.md", sizeRaw: 12 };
    const [local, remote, previous] = excludeOversizedFiles(
      [large, normal],
      [{ ...large, sizeRaw: 0 }, normal],
      [large]
    );
    assert.deepEqual(local.map((x) => x.key), ["new.md"]);
    assert.deepEqual(remote.map((x) => x.key), ["new.md"]);
    assert.deepEqual(previous, []);
  });
});

describe("Sync: checkIsSkipItemOrNotByName", () => {
  it("includes new underscore files while still excluding Obsidian settings", () => {
    const shouldSkip = (key: string) => checkIsSkipItemOrNotByName(
      key, false, false, true, ".obsidian", [], []
    ).finalIsIgnored;
    assert.equal(shouldSkip("_new.md"), false);
    assert.equal(shouldSkip("_notes/new.md"), false);
    assert.equal(shouldSkip(".obsidian/plugins/remotely-save-http/data.json"), true);
  });

  it("should be ok everywhere for empty config", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [""],
      /* onlyAllowPaths */ ["", "\n"]
    ).finalIsIgnored;
    assert.ok(!isSkip);
  });

  it("should be ok for deny list", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx$"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    // if we deny a folder, we have to deny all the sub files
    // TODO: it's soooo hard to do the path resolution in this func with regex,
    //       so we defer the detection to later steps now.
    //       the test here doesn't work.
    // isSkip = checkIsSkipItemOrNotByName(
    //   'xxx/yyy.md',
    //   false,
    //   false,
    //   false,
    //   '.obsidian',
    //   /*    ignorePaths */ ['xxx/$'],
    //   /* onlyAllowPaths */ []
    // ).finalIsIgnored;
    // assert.ok(isSkip);
  });

  it("should be ok for allow list", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ ["xxx"]
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [""],
      /* onlyAllowPaths */ ["xxx"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ ["xxx$"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    // should NOT skip because we allow the sub file AND not deny the folder
    // TODO: it's soooo hard to do the path resolution in this func with regex,
    //       so we defer the detection to later steps now.
    //       the test here doesn't work.
    // isSkip = checkIsSkipItemOrNotByName(
    //   'xxx/',
    //   false,
    //   false,
    //   false,
    //   '.obsidian',
    //   /*    ignorePaths */ [],
    //   /* onlyAllowPaths */ ['xxx/yyy.md']
    // ).finalIsIgnored;
    // assert.ok(!isSkip);
  });

  it("should detect the name by two lists together", async () => {
    // should skip because we ignore the path
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ ["yyy"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    // should skip because we disallow the whole folder
    isSkip = checkIsSkipItemOrNotByName(
      "xxx/yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ ["xxx/yyy.md"]
    ).finalIsIgnored;
    assert.ok(isSkip);
  });
});
