import type { Entity } from "./baseTypes";
import { FakeFs } from "./fsAll";

function withSyncFields(entity: Entity): Entity {
  return {
    ...entity,
    keyEnc: entity.keyRaw,
    sizeEnc: entity.sizeRaw,
  };
}

/** Plain WebDAV adapter for the sync engine's key and size bookkeeping. */
export class FakeFsPlain extends FakeFs {
  kind: string;
  readonly innerFs: FakeFs;
  private keys = new Set<string>();
  private walked = false;

  constructor(innerFs: FakeFs) {
    super();
    this.innerFs = innerFs;
    this.kind = `plain(${innerFs.kind})`;
  }

  private remember(entities: Entity[]): Entity[] {
    for (const entity of entities) {
      if (entity.key !== undefined) this.keys.add(entity.key);
    }
    this.walked = true;
    return entities.map(withSyncFields);
  }

  async walk(): Promise<Entity[]> {
    return this.remember(await this.innerFs.walk());
  }

  async walkPartial(): Promise<Entity[]> {
    return this.remember(await this.innerFs.walkPartial());
  }

  async isPasswordOk(): Promise<{ ok: boolean; reason: string }> {
    const entries = await this.walkPartial();
    if (entries.some((entry) => entry.keyRaw.startsWith("U2FsdGVkX"))) {
      return { ok: false, reason: "remote_encrypted_local_no_password" };
    }
    return { ok: true, reason: "likely_no_password_both_sides" };
  }

  async encryptEntity(entity: Entity): Promise<Entity> {
    return withSyncFields(entity);
  }

  private requireWalk() {
    if (!this.walked) throw Error("Remote files must be listed before sync operations");
  }

  async stat(key: string): Promise<Entity> {
    this.requireWalk();
    if (!this.keys.has(key)) throw Error(`Remote key ${key} was not listed`);
    return withSyncFields(await this.innerFs.stat(key));
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    this.requireWalk();
    this.keys.add(key);
    return withSyncFields(await this.innerFs.mkdir(key, mtime, ctime));
  }

  async writeFile(key: string, content: ArrayBuffer, mtime: number, ctime: number): Promise<Entity> {
    this.requireWalk();
    this.keys.add(key);
    return withSyncFields(await this.innerFs.writeFile(key, content, mtime, ctime));
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    this.requireWalk();
    if (!this.keys.has(key)) throw Error(`Remote key ${key} was not listed`);
    return this.innerFs.readFile(key);
  }

  async rename(from: string, to: string): Promise<void> {
    this.requireWalk();
    this.keys.add(to);
    await this.innerFs.rename(from, to);
  }

  async rm(key: string): Promise<void> {
    this.requireWalk();
    if (!this.keys.has(key)) throw Error(`Remote key ${key} was not listed`);
    await this.innerFs.rm(key);
  }

  checkConnect(callbackFunc?: any): Promise<boolean> {
    return this.innerFs.checkConnect(callbackFunc);
  }

  getUserDisplayName(): Promise<string> {
    return this.innerFs.getUserDisplayName();
  }

  revokeAuth(): Promise<any> {
    return this.innerFs.revokeAuth();
  }

  allowEmptyFile(): boolean {
    return this.innerFs.allowEmptyFile();
  }

  closeResources(): void {}
}
