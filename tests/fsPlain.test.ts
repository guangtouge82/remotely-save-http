import { strict as assert } from "assert";
import type { Entity } from "../src/baseTypes";
import { FakeFs } from "../src/fsAll";
import { FakeFsPlain } from "../src/fsPlain";

class MemoryRemote extends FakeFs {
  kind = "webdav";
  files = new Map<string, ArrayBuffer>([["note.md", new Uint8Array([1, 2]).buffer]]);

  async walk(): Promise<Entity[]> {
    return [...this.files].map(([key, content]) => ({
      key, keyRaw: key, size: content.byteLength, sizeRaw: content.byteLength,
    }));
  }
  walkPartial(): Promise<Entity[]> { return this.walk(); }
  async stat(key: string): Promise<Entity> {
    const content = this.files.get(key);
    if (!content) throw Error("missing file");
    return { key, keyRaw: key, size: content.byteLength, sizeRaw: content.byteLength };
  }
  async mkdir(key: string): Promise<Entity> {
    return { key, keyRaw: key, size: 0, sizeRaw: 0 };
  }
  async writeFile(key: string, content: ArrayBuffer): Promise<Entity> {
    this.files.set(key, content);
    return this.stat(key);
  }
  async readFile(key: string): Promise<ArrayBuffer> {
    const content = this.files.get(key);
    if (!content) throw Error("missing file");
    return content;
  }
  async rename(from: string, to: string): Promise<void> {
    this.files.set(to, await this.readFile(from));
    this.files.delete(from);
  }
  async rm(key: string): Promise<void> { this.files.delete(key); }
  async checkConnect(): Promise<boolean> { return true; }
  async getUserDisplayName(): Promise<string> { return ""; }
  async revokeAuth(): Promise<void> {}
  allowEmptyFile(): boolean { return true; }
}

describe("Plain WebDAV sync adapter", () => {
  it("keeps raw keys and sizes and passes file content through", async () => {
    const remote = new MemoryRemote();
    const fs = new FakeFsPlain(remote);
    assert.equal(fs.innerFs, remote);
    assert.equal((await fs.isPasswordOk()).ok, true);
    assert.deepEqual(await fs.walk(), [{
      key: "note.md", keyRaw: "note.md", keyEnc: "note.md", size: 2, sizeRaw: 2, sizeEnc: 2,
    }]);
    const content = new Uint8Array([3, 4, 5]).buffer;
    await fs.writeFile("new.md", content, 0, 0);
    assert.deepEqual(new Uint8Array(await fs.readFile("new.md")), new Uint8Array(content));
    assert.deepEqual(await fs.encryptEntity(await fs.stat("new.md")), {
      key: "new.md", keyRaw: "new.md", keyEnc: "new.md", size: 3, sizeRaw: 3, sizeEnc: 3,
    });
  });
});
