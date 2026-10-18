import type { RemotelySavePluginSettings } from "./baseTypes";
import { FakeFsWebdav } from "./fsWebdav";

/** WebDAV is the only remote backend in this build. */
export function getClient(
  settings: RemotelySavePluginSettings,
  vaultName: string,
  saveUpdatedConfigFunc: () => Promise<any>
): FakeFsWebdav {
  return new FakeFsWebdav(settings.webdav, vaultName, saveUpdatedConfigFunc);
}
