import type { Entity } from "./baseTypes";

/** Prefer WebDAV ETags; fall back to modified time when the server omits them. */
export function remoteMatchesPreviousVersion(
  previous: Entity | undefined,
  remote: Entity
): boolean {
  if (previous === undefined || previous.sizeEnc !== remote.sizeEnc) {
    return false;
  }
  if (previous.etag && remote.etag) {
    return previous.etag === remote.etag;
  }
  return previous.mtimeSvr === remote.mtimeCli ||
    previous.mtimeSvr === remote.mtimeSvr;
}

export function remoteEtagChanged(
  previous: Entity | undefined,
  remote: Entity
): boolean {
  return Boolean(previous?.etag && remote.etag && previous.etag !== remote.etag);
}
