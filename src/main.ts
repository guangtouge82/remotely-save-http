// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
import AggregateError from "aggregate-error";
import cloneDeep from "lodash/cloneDeep";
import throttle from "lodash/throttle";
import type { EditorView } from "@codemirror/view";
import { RefreshCcw, RotateCcw, createElement } from "lucide";
import {
  Events,
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFolder,
  addIcon,
  setIcon,
} from "obsidian";
import { syncer } from "../pro/src/sync";
import type {
  RemotelySavePluginSettings,
  SyncTriggerSourceType,
} from "./baseTypes";
import { messyConfigToNormal, normalConfigToMessy } from "./configPersist";
import { getClient } from "./fsGetter";
import { FakeFsLocal } from "./fsLocal";
import { FakeFsPlain } from "./fsPlain";
import { DEFAULT_WEBDAV_CONFIG } from "./fsWebdav";
import { childListLineAfterSpace } from "./editorListIndent";
import { findNarrowRange } from "./listSubtree";
import { exitNarrowMode, narrowAnchor, narrowExitButton, narrowModeField, setNarrowAnchor } from "./narrowMode";
import { I18n } from "./i18n";
import type { LangTypeAndAuto, TransItemType } from "./i18n";
import {
  type InternalDBs,
  clearAllLoggerOutputRecords,
  clearExpiredSyncPlanRecords,
  getLastFailedSyncTimeByVault,
  getLastSuccessSyncTimeByVault,
  prepareDBs,
  upsertLastFailedSyncTimeByVault,
  upsertLastSuccessSyncTimeByVault,
  upsertPluginVersionByVault,
} from "./localdb";
import { changeMobileStatusBar } from "./misc";
import { DEFAULT_PROFILER_CONFIG, Profiler } from "./profiler";
import { normalizeScheduledMergeIntervalSeconds } from "./scheduledMerge";
import { RemotelySaveSettingTab } from "./settingsWebdavOnly";
import {
  advanceSyncProgress,
  completeSyncProgress,
  progressForCompletedFiles,
  startSyncProgress,
  type SyncProgress,
} from "./syncProgress";

const DEFAULT_SETTINGS = {
  webdav: DEFAULT_WEBDAV_CONFIG,
  password: "",
  serviceType: "webdav",
  currLogLevel: "info",
  // vaultRandomID: "", // deprecated
  autoRunEveryMilliseconds: -1,
  scheduledMergeIntervalSeconds: 5,
  initRunAfterMilliseconds: -1,
  syncOnSaveAfterMilliseconds: -1,
  agreeToUploadExtraMetadata: true, // as of 20240106, it's safe to assume every new user agrees with this
  concurrency: 5,
  syncConfigDir: false,
  syncBookmarks: false,
  syncUnderscoreItems: true,
  lang: "auto",
  logToDB: false,
  skipSizeLargerThan: -1,
  ignorePaths: [],
  onlyAllowPaths: [],
  enableStatusBarInfo: true,
  deleteToWhere: "system",
  agreeToUseSyncV3: true,
  conflictAction: "smart_conflict",
  howToCleanEmptyFolder: "clean_both",
  protectModifyPercentage: -1,
  syncDirection: "bidirectional",
  obfuscateSettingFile: true,
  enableMobileStatusBar: false,
  encryptionMethod: "rclone-base64",
  profiler: DEFAULT_PROFILER_CONFIG,
} as unknown as RemotelySavePluginSettings;

const iconNameSyncWait = `remotely-save-sync-wait`;
const iconNameSyncRunning = `remotely-save-sync-running`;

const getIconSvg = () => {
  const iconSvgSyncWait = createElement(RotateCcw);
  iconSvgSyncWait.setAttribute("width", "100");
  iconSvgSyncWait.setAttribute("height", "100");
  const iconSvgSyncRunning = createElement(RefreshCcw);
  iconSvgSyncRunning.setAttribute("width", "100");
  iconSvgSyncRunning.setAttribute("height", "100");
  const res = {
    iconSvgSyncWait: iconSvgSyncWait.outerHTML,
    iconSvgSyncRunning: iconSvgSyncRunning.outerHTML,
  };

  iconSvgSyncWait.empty();
  iconSvgSyncRunning.empty();
  return res;
};

const getStatusBarShortMsgFromSyncSource = (
  t: (x: TransItemType, vars?: any) => string,
  s: SyncTriggerSourceType | undefined
) => {
  if (s === undefined) {
    return "";
  }
  switch (s) {
    case "manual":
      return t("statusbar_sync_source_manual");
    case "dry":
      return t("statusbar_sync_source_dry");
    case "auto":
      return t("statusbar_sync_source_auto");
    case "auto_once_init":
      return t("statusbar_sync_source_auto_once_init");
    case "auto_sync_on_save":
      return t("statusbar_sync_source_auto_sync_on_save");
    default:
      throw Error(`no translate for ${s}`);
  }
};

export default class RemotelySavePlugin extends Plugin {
  settings!: RemotelySavePluginSettings;
  db!: InternalDBs;
  isSyncing!: boolean;
  hasPendingSyncOnSave!: boolean;
  statusBarElement!: HTMLSpanElement;
  currLogLevel!: string;
  currSyncMsg?: string;
  syncRibbon?: HTMLElement;
  autoRunIntervalID?: number;
  syncOnSaveIntervalID?: number;
  i18n!: I18n;
  vaultRandomID!: string;
  debugServerTemp?: string;
  syncEvent?: Events;
  appContainerObserver?: MutationObserver;
  syncProgress?: SyncProgress;
  syncProgressElement?: HTMLDivElement;
  syncProgressFill?: HTMLDivElement;
  syncProgressLabel?: HTMLSpanElement;
  syncProgressHideTimer?: number;

  renderSyncProgress(progress: SyncProgress) {
    if (this.syncProgressHideTimer !== undefined) {
      window.clearTimeout(this.syncProgressHideTimer);
      this.syncProgressHideTimer = undefined;
    }
    if (this.syncProgressElement === undefined) {
      const element = document.createElement("div");
      element.className = "rsh-sync-progress";
      element.setAttribute("role", "progressbar");
      element.setAttribute("aria-valuemin", "0");
      element.setAttribute("aria-valuemax", "100");
      const track = document.createElement("div");
      track.className = "rsh-sync-progress-track";
      const fill = document.createElement("div");
      fill.className = "rsh-sync-progress-fill";
      track.appendChild(fill);
      const label = document.createElement("span");
      label.className = "rsh-sync-progress-label";
      element.append(track, label);
      document.body.appendChild(element);
      this.syncProgressElement = element;
      this.syncProgressFill = fill;
      this.syncProgressLabel = label;
    }
    const statusKey = progress.state === "running"
      ? "sync_progress_running"
      : progress.state === "success"
        ? "sync_progress_success"
        : "sync_progress_error";
    const status = this.i18n.t(statusKey);
    this.syncProgressElement.dataset.state = progress.state;
    this.syncProgressElement.setAttribute("aria-valuenow", String(progress.percent));
    this.syncProgressElement.setAttribute("aria-label", status);
    this.syncProgressFill!.style.width = `${progress.percent}%`;
    this.syncProgressLabel!.textContent = `${status} ${progress.percent}%`;
    this.syncProgress = progress;
    if (progress.state !== "running") {
      this.syncProgressHideTimer = window.setTimeout(() => {
        this.syncProgressElement?.remove();
        this.syncProgressElement = undefined;
        this.syncProgressFill = undefined;
        this.syncProgressLabel = undefined;
        this.syncProgressHideTimer = undefined;
      }, 1500);
    }
  }

  async syncRun(triggerSource: SyncTriggerSourceType = "manual") {
    let profiler: Profiler | undefined = undefined;
    if (this.settings.profiler?.enable ?? false) {
      profiler = new Profiler(
        undefined,
        this.settings.profiler?.enablePrinting ?? false,
        this.settings.profiler?.recordSize ?? false
      );
    }
    const fsLocal = new FakeFsLocal(
      this.app.vault,
      this.settings.syncConfigDir ?? false,
      this.settings.syncBookmarks ?? false,
      this.app.vault.configDir,
      this.manifest.id,
      profiler,
      this.settings.deleteToWhere ?? "system"
    );
    const fsRemote = getClient(
      this.settings,
      this.app.vault.getName(),
      async () => await this.saveSettings()
    );
    const fsEncrypt = new FakeFsPlain(fsRemote);

    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };

    const profileID = this.getCurrProfileID();

    const getProtectError = (
      protectModifyPercentage: number,
      realModifyDeleteCount: number,
      allFilesCount: number
    ) => {
      const percent = ((100 * realModifyDeleteCount) / allFilesCount).toFixed(
        1
      );
      const res = t("syncrun_abort_protectmodifypercentage", {
        protectModifyPercentage,
        realModifyDeleteCount,
        allFilesCount,
        percent,
      });
      return res;
    };

    const getNotice = (
      s: SyncTriggerSourceType,
      msg: string,
      timeout?: number
    ) => {
      if (s === "manual" || s === "dry") {
        new Notice(msg, timeout);
      }
    };

    const notifyFunc = async (s: SyncTriggerSourceType, step: number) => {
      if (this.syncProgress !== undefined && step >= 1 && step <= 7) {
        this.renderSyncProgress(advanceSyncProgress(this.syncProgress, step));
      }
      switch (step) {
        case 0:
          if (s === "dry") {
            if (this.settings.currLogLevel === "info") {
              getNotice(s, t("syncrun_shortstep0"));
            } else {
              getNotice(s, t("syncrun_step0"));
            }
          }

          break;

        case 1:
          if (this.settings.currLogLevel === "info") {
            getNotice(
              s,
              t("syncrun_shortstep1", {
                serviceType: this.settings.serviceType,
              })
            );
          } else {
            getNotice(
              s,
              t("syncrun_step1", {
                serviceType: this.settings.serviceType,
              })
            );
          }
          break;

        case 2:
          if (this.settings.currLogLevel === "info") {
            // pass
          } else {
            getNotice(s, t("syncrun_step2"));
          }
          break;

        case 3:
          if (this.settings.currLogLevel === "info") {
            // pass
          } else {
            getNotice(s, t("syncrun_step3"));
          }
          break;

        case 4:
          if (this.settings.currLogLevel === "info") {
            // pass
          } else {
            getNotice(s, t("syncrun_step4"));
          }
          break;

        case 5:
          if (this.settings.currLogLevel === "info") {
            // pass
          } else {
            getNotice(s, t("syncrun_step5"));
          }
          break;

        case 6:
          if (this.settings.currLogLevel === "info") {
            // pass
          } else {
            getNotice(s, t("syncrun_step6"));
          }
          break;

        case 7:
          if (s === "dry") {
            if (this.settings.currLogLevel === "info") {
              getNotice(s, t("syncrun_shortstep2skip"));
            } else {
              getNotice(s, t("syncrun_step7skip"));
            }
          } else {
            if (this.settings.currLogLevel === "info") {
              // pass
            } else {
              getNotice(s, t("syncrun_step7"));
            }
          }
          break;

        case 8:
          if (this.settings.currLogLevel === "info") {
            getNotice(s, t("syncrun_shortstep2"));
          } else {
            getNotice(s, t("syncrun_step8"));
          }
          break;

        default:
          throw Error(`unknown step=${step} for showing notice`);
      }
    };

    const errNotifyFunc = async (s: SyncTriggerSourceType, error: Error) => {
      console.error(error);
      if (error instanceof AggregateError) {
        for (const e of error.errors) {
          getNotice(s, e.message, 10 * 1000);
        }
      } else {
        getNotice(s, error?.message ?? "error while sync", 10 * 1000);
      }
    };

    const ribboonFunc = async (s: SyncTriggerSourceType, step: number) => {
      if (s === "auto") return;
      if (step === 1) {
        if (this.syncRibbon !== undefined) {
          setIcon(this.syncRibbon, iconNameSyncRunning);
          this.syncRibbon.setAttribute(
            "aria-label",
            t("syncrun_syncingribbon", {
              pluginName: this.manifest.name,
              triggerSource: s,
            })
          );
        }
      } else if (step === 8) {
        // last step
        if (this.syncRibbon !== undefined) {
          setIcon(this.syncRibbon, iconNameSyncWait);
          const originLabel = `${this.manifest.name}`;
          this.syncRibbon.setAttribute("aria-label", originLabel);
        }
      }
    };

    const statusBarFunc = async (
      s: SyncTriggerSourceType,
      step: number,
      everythingOk: boolean
    ) => {
      if (step === 8 && this.syncProgress !== undefined) {
        this.renderSyncProgress(completeSyncProgress(this.syncProgress, everythingOk));
      }
      if (step === 1 && s !== "auto") {
        // change status to "syncing..." on statusbar
        this.updateLastSyncMsg(s, "syncing", -1, -1);
      } else if (step === 8 && everythingOk) {
        const ts = Date.now();
        await upsertLastSuccessSyncTimeByVault(this.db, this.vaultRandomID, ts);
        if (s !== "auto") this.updateLastSyncMsg(s, "not_syncing", ts, null); // hack: 'not_syncing'
      } else if (!everythingOk) {
        const ts = Date.now();
        await upsertLastFailedSyncTimeByVault(this.db, this.vaultRandomID, ts);
        if (s !== "auto") this.updateLastSyncMsg(s, "not_syncing", null, ts);
      }
    };

    const markIsSyncingFunc = async (isSyncing: boolean) => {
      this.isSyncing = isSyncing;
    };

    const callbackSyncProcess = async (
      s: SyncTriggerSourceType,
      realCounter: number,
      realTotalCount: number,
      pathName: string,
      decision: string
    ) => {
      if (this.syncProgress !== undefined) {
        const nextProgress = progressForCompletedFiles(
          this.syncProgress,
          realCounter,
          realTotalCount
        );
        if (nextProgress.percent !== this.syncProgress.percent) {
          this.renderSyncProgress(nextProgress);
        }
      }
      if (s === "auto") return;
      this.setCurrSyncMsg(
        t,
        s,
        realCounter,
        realTotalCount,
        pathName,
        decision,
        triggerSource
      );
    };

    if (this.isSyncing) {
      getNotice(
        triggerSource,
        t("syncrun_alreadyrunning", {
          pluginName: this.manifest.name,
          syncStatus: "running",
          newTriggerSource: triggerSource,
        })
      );

      if (this.currSyncMsg !== undefined && this.currSyncMsg !== "") {
        getNotice(triggerSource, this.currSyncMsg);
      }
      return;
    }

    const configSaver = async () => await this.saveSettings();

    try {
      this.renderSyncProgress(startSyncProgress());
      await syncer(
        fsLocal,
        fsRemote,
        fsEncrypt,
        profiler,
        this.db,
        triggerSource,
        profileID,
        this.vaultRandomID,
        this.app.vault.configDir,
        this.settings,
        this.manifest.version,
        configSaver,
        getProtectError,
        markIsSyncingFunc,
        notifyFunc,
        errNotifyFunc,
        ribboonFunc,
        statusBarFunc,
        callbackSyncProcess
      );
    } finally {
      if (this.syncProgress?.state === "running") {
        this.renderSyncProgress(completeSyncProgress(this.syncProgress, false));
      }
      this.isSyncing = false;
      fsEncrypt.closeResources();
      profiler?.clear();
      this.syncEvent?.trigger("SYNC_DONE");
    }
  }

  async onload() {
    console.info(`loading plugin ${this.manifest.id}`);

    const { iconSvgSyncWait, iconSvgSyncRunning } = getIconSvg();

    addIcon(iconNameSyncWait, iconSvgSyncWait);
    addIcon(iconNameSyncRunning, iconSvgSyncRunning);

    this.currSyncMsg = "";
    this.isSyncing = false;
    this.hasPendingSyncOnSave = false;

    this.syncEvent = new Events();

    await this.loadSettings();

    // MUST after loadSettings and before prepareDB
    const profileID: string = this.getCurrProfileID();

    // lang should be load early, but after settings
    this.i18n = new I18n(this.settings.lang!, async (lang: LangTypeAndAuto) => {
      this.settings.lang = lang;
      await this.saveSettings();
    });
    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };


    // MUST before prepareDB()
    // And, it's also possible to be an empty string,
    // which means the vaultRandomID is read from db later!
    const vaultRandomIDFromOldConfigFile =
      await this.getVaultRandomIDFromOldConfigFile();

    // no need to await this
    this.tryToAddIgnoreFile();

    const vaultBasePath = this.getVaultBasePath();

    try {
      await this.prepareDBAndVaultRandomID(
        vaultBasePath,
        vaultRandomIDFromOldConfigFile,
        profileID
      );
    } catch (err: any) {
      new Notice(
        err?.message ?? "error of prepareDBAndVaultRandomID",
        10 * 1000
      );
      throw err;
    }

    // must AFTER preparing DB
    this.enableAutoClearOutputToDBHistIfSet();

    // must AFTER preparing DB
    this.enableAutoClearSyncPlanHist();

    this.syncRibbon = this.addRibbonIcon(
      iconNameSyncWait,
      `${this.manifest.name}`,
      async () => this.syncRun("manual")
    );

    this.enableMobileStatusBarIfSet();

    // Create Status Bar Item
    if (
      (!Platform.isMobile ||
        (Platform.isMobile && this.settings.enableMobileStatusBar)) &&
      this.settings.enableStatusBarInfo === true
    ) {
      const statusBarItem = this.addStatusBarItem();
      this.statusBarElement = statusBarItem.createEl("span");
      this.statusBarElement.setAttribute("data-tooltip-position", "top");

      if (!this.isSyncing) {
        this.updateLastSyncMsg(
          undefined,
          "not_syncing",
          await getLastSuccessSyncTimeByVault(this.db, this.vaultRandomID),
          await getLastFailedSyncTimeByVault(this.db, this.vaultRandomID)
        );
      }
      // update statusbar text every 30 seconds
      this.registerInterval(
        window.setInterval(async () => {
          if (!this.isSyncing) {
            this.updateLastSyncMsg(
              undefined,
              "not_syncing",
              await getLastSuccessSyncTimeByVault(this.db, this.vaultRandomID),
              await getLastFailedSyncTimeByVault(this.db, this.vaultRandomID)
            );
          }
        }, 1000 * 30)
      );
    }

    this.addCommand({
      id: "start-sync",
      name: t("command_startsync"),
      icon: iconNameSyncWait,
      callback: async () => {
        await this.syncRun("manual");
      },
    });

    this.registerEditorExtension([narrowModeField, narrowExitButton]);
    const toggleNarrowMode = (editor: MarkdownView["editor"]) => {
      const cm = (editor as typeof editor & { cm?: EditorView }).cm;
      if (!cm) return;
      if (narrowAnchor(cm) !== null) {
        exitNarrowMode(cm);
        return;
      }
      const selectedLine = editor.getCursor("from").line;
      const subtree = findNarrowRange(editor.lineCount(), (line) => editor.getLine(line), selectedLine);
      if (!subtree) {
        new Notice("请将光标放在 Markdown 标题或列表节点上，再进入聚焦编辑。", 3000);
        return;
      }
      const from = cm.state.doc.line(subtree.firstLine + 1).from;
      const to = cm.state.doc.line(subtree.lastLine + 1).to;
      const head = cm.state.selection.main.head;
      const isHeading = /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(editor.getLine(selectedLine));
      let bodyLine = selectedLine + 1;
      if (isHeading) {
        while (bodyLine <= subtree.lastLine && editor.getLine(bodyLine).trim() === "") bodyLine++;
      }
      const moveIntoBody = isHeading && bodyLine <= subtree.lastLine;
      cm.dispatch({
        effects: setNarrowAnchor.of(from),
        ...(moveIntoBody
          ? { selection: { anchor: cm.state.doc.line(bodyLine + 1).from } }
          : head < from || head > to ? { selection: { anchor: from } } : {}),
      });
      if (isHeading && !moveIntoBody) editor.blur();
      else editor.focus();
      new Notice("已聚焦当前节点；点击退出聚焦按钮或再次运行命令退出。", 3000);
    };
    this.addCommand({
      id: "toggle-narrow-list-item",
      name: "聚焦当前节点 / 退出聚焦",
      editorCallback: (editor) => toggleNarrowMode(editor),
    });
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      const cm = (editor as typeof editor & { cm?: EditorView }).cm;
      if (!cm) return;
      const active = narrowAnchor(cm) !== null;
      menu.addItem((item) => item
        .setTitle(active ? "退出聚焦编辑" : "聚焦当前节点")
        .setIcon(active ? "minimize" : "focus")
        .onClick(() => toggleNarrowMode(editor)));
    }));
    this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.isComposing ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !(event.target instanceof Element) ||
        !event.target.closest('.cm-content[contenteditable="true"]')
      ) return;

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.containerEl.contains(event.target)) return;
      const editor = view.editor;
      if (editor.somethingSelected()) return;
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      const child = childListLineAfterSpace(line, cursor.ch);
      if (!child) return;

      event.preventDefault();
      event.stopPropagation();
      editor.replaceRange(
        child.insertion,
        { line: cursor.line, ch: child.fromCh },
        cursor,
        "input"
      );
      editor.setCursor({
        line: cursor.line + 1,
        ch: child.insertion.length - 1,
      });
    }, true);

    this.addSettingTab(new RemotelySaveSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => this.configureScheduledMerge());

    // this.registerDomEvent(document, "click", (evt: MouseEvent) => {
    //   console.info("click", evt);
    // });

    this.enableCheckingFileStat();


    // compare versions and read new versions
    const { oldVersion } = await upsertPluginVersionByVault(
      this.db,
      this.vaultRandomID,
      this.manifest.version
    );
  }

  async onunload() {
    console.info(`unloading plugin ${this.manifest.id}`);
    if (this.syncProgressHideTimer !== undefined) {
      window.clearTimeout(this.syncProgressHideTimer);
      this.syncProgressHideTimer = undefined;
    }
    this.syncProgressElement?.remove();
    this.syncProgressElement = undefined;
    this.syncRibbon = undefined;
    if (this.appContainerObserver !== undefined) {
      this.appContainerObserver.disconnect();
      this.appContainerObserver = undefined;
    }
  }

  async loadSettings() {
    const stored = messyConfigToNormal(await this.loadData());
    this.settings = Object.assign({}, cloneDeep(DEFAULT_SETTINGS), stored, {
      webdav: Object.assign({}, cloneDeep(DEFAULT_WEBDAV_CONFIG), stored?.webdav),
      serviceType: "webdav",
      password: "",
      autoRunEveryMilliseconds: -1,
      // Move old positive minute settings to the new five-second default; keep Off.
      scheduledMergeIntervalSeconds: normalizeScheduledMergeIntervalSeconds(
        stored?.scheduledMergeIntervalSeconds ??
          (stored?.scheduledMergeIntervalMinutes === -1 ? -1 : undefined)
      ),
      initRunAfterMilliseconds: -1,
      syncOnSaveAfterMilliseconds: -1,
      syncConfigDir: false,
      syncBookmarks: false,
      syncUnderscoreItems: true,
      ignorePaths: [],
      onlyAllowPaths: [],
      skipSizeLargerThan: -1,
      syncDirection: "bidirectional",
      conflictAction: "smart_conflict",
      // This WebDAV build must not abort when a legitimate change affects most files.
      protectModifyPercentage: -1,
      encryptionMethod: "rclone-base64",
      agreeToUseSyncV3: true,
    });

    if (
      this.settings.webdav.depth === undefined ||
      this.settings.webdav.depth.startsWith("auto")
    ) {
      this.settings.webdav.depth = "manual_1";
      this.settings.webdav.manualRecursive = true;
    }
    this.settings.webdav.remoteBaseDir ??= "";
    this.settings.webdav.customHeaders ??= "";
    await this.saveSettings();
  }

  async saveSettings() {
    if (this.settings.obfuscateSettingFile) {
      await this.saveData(normalConfigToMessy(this.settings));
    } else {
      await this.saveData(this.settings);
    }
  }

  /**
   * After 202403 the data should be of profile based.
   */
  getCurrProfileID() {
    if (this.settings.serviceType !== undefined) {
      return `${this.settings.serviceType}-default-1`;
    } else {
      throw Error("unknown serviceType in the setting!");
    }
  }

  async getVaultRandomIDFromOldConfigFile() {
    let vaultRandomID = "";
    if (this.settings.vaultRandomID !== undefined) {
      // In old version, the vault id is saved in data.json
      // But we want to store it in localForage later
      if (this.settings.vaultRandomID !== "") {
        // a real string was assigned before
        vaultRandomID = this.settings.vaultRandomID;
      }
      console.debug("vaultRandomID is no longer saved in data.json");
      delete this.settings.vaultRandomID;
      await this.saveSettings();
    }
    return vaultRandomID;
  }

  async trash(x: string) {
    if (this.settings.deleteToWhere === "obsidian") {
      await this.app.vault.adapter.trashLocal(x);
    } else {
      // "system"
      if (!(await this.app.vault.adapter.trashSystem(x))) {
        await this.app.vault.adapter.trashLocal(x);
      }
    }
  }

  getVaultBasePath() {
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      // in desktop
      return this.app.vault.adapter.getBasePath().split("?")[0];
    } else {
      // in mobile
      return this.app.vault.adapter.getResourcePath("").split("?")[0];
    }
  }

  async prepareDBAndVaultRandomID(
    vaultBasePath: string,
    vaultRandomIDFromOldConfigFile: string,
    profileID: string
  ) {
    const { db, vaultRandomID } = await prepareDBs(
      vaultBasePath,
      vaultRandomIDFromOldConfigFile,
      profileID
    );
    this.db = db;
    this.vaultRandomID = vaultRandomID;
  }

  configureScheduledMerge() {
    if (this.autoRunIntervalID !== undefined) {
      window.clearInterval(this.autoRunIntervalID);
      this.autoRunIntervalID = undefined;
    }

    const seconds = normalizeScheduledMergeIntervalSeconds(
      this.settings.scheduledMergeIntervalSeconds
    );
    if (seconds < 0) return;

    const intervalID = window.setInterval(() => {
      if (this.isSyncing) return;
      try {
        const url = new URL(this.settings.webdav.address);
        if (!(["http:", "https:"].includes(url.protocol) && url.hostname)) return;
      } catch {
        return;
      }
      void this.syncRun("auto").catch((error) => {
        console.error("Scheduled merge sync failed", error);
      });
    }, seconds * 1000);
    this.autoRunIntervalID = intervalID;
    this.registerInterval(intervalID);
  }

  enableInitSyncIfSet() {
    if (
      this.settings.initRunAfterMilliseconds !== undefined &&
      this.settings.initRunAfterMilliseconds !== null &&
      this.settings.initRunAfterMilliseconds > 0
    ) {
      this.app.workspace.onLayoutReady(() => {
        window.setTimeout(() => {
          this.syncRun("auto_once_init");
        }, this.settings.initRunAfterMilliseconds);
      });
    }
  }

  async _checkCurrFileModified(caller: "SYNC" | "FILE_CHANGES") {
    console.debug(`inside checkCurrFileModified`);
    const currentFile = this.app.workspace.getActiveFile();

    if (currentFile) {
      console.debug(`we have currentFile=${currentFile.path}`);
      // get the last modified time of the current file
      // if it has modified after lastSuccessSync
      // then schedule a run for syncOnSaveAfterMilliseconds after it was modified
      const lastModified = currentFile.stat.mtime;
      const lastSuccessSyncMillis = await getLastSuccessSyncTimeByVault(
        this.db,
        this.vaultRandomID
      );

      console.debug(
        `lastModified=${lastModified}, lastSuccessSyncMillis=${lastSuccessSyncMillis}`
      );

      if (
        caller === "SYNC" ||
        (caller === "FILE_CHANGES" &&
          lastModified > (lastSuccessSyncMillis ?? 1))
      ) {
        console.debug(
          `so lastModified > lastSuccessSyncMillis or it's called while syncing before`
        );
        console.debug(
          `caller=${caller}, isSyncing=${this.isSyncing}, hasPendingSyncOnSave=${this.hasPendingSyncOnSave}`
        );
        if (this.isSyncing) {
          this.hasPendingSyncOnSave = true;
          // wait for next event
          return;
        } else {
          if (this.hasPendingSyncOnSave || caller === "FILE_CHANGES") {
            this.hasPendingSyncOnSave = false;
            await this.syncRun("auto_sync_on_save");
          }
          return;
        }
      }
    } else {
      console.debug(`no currentFile here`);
    }
  }

  _syncOnSaveEvent1 = () => {
    this._checkCurrFileModified("SYNC");
  };

  _syncOnSaveEvent2 = throttle(
    async () => {
      await this._checkCurrFileModified("FILE_CHANGES");
    },
    1000 * 3,
    {
      leading: false,
      trailing: true,
    }
  );

  toggleSyncOnSaveIfSet() {
    if (
      this.settings.syncOnSaveAfterMilliseconds !== undefined &&
      this.settings.syncOnSaveAfterMilliseconds !== null &&
      this.settings.syncOnSaveAfterMilliseconds > 0
    ) {
      this.app.workspace.onLayoutReady(() => {
        // listen to sync done
        this.registerEvent(
          this.syncEvent?.on("SYNC_DONE", this._syncOnSaveEvent1)!
        );

        // listen to current file save changes
        this.registerEvent(this.app.vault.on("modify", this._syncOnSaveEvent2));
        this.registerEvent(this.app.vault.on("create", this._syncOnSaveEvent2));
        this.registerEvent(this.app.vault.on("delete", this._syncOnSaveEvent2));
        this.registerEvent(this.app.vault.on("rename", this._syncOnSaveEvent2));
      });
    } else {
      this.syncEvent?.off("SYNC_DONE", this._syncOnSaveEvent1);
      this.app.vault.off("modify", this._syncOnSaveEvent2);
      this.app.vault.off("create", this._syncOnSaveEvent2);
      this.app.vault.off("delete", this._syncOnSaveEvent2);
      this.app.vault.off("rename", this._syncOnSaveEvent2);
    }
  }

  enableMobileStatusBarIfSet() {
    this.app.workspace.onLayoutReady(() => {
      if (Platform.isMobile && this.settings.enableMobileStatusBar) {
        this.appContainerObserver = changeMobileStatusBar("enable");
      }
    });
  }

  enableCheckingFileStat() {
    this.app.workspace.onLayoutReady(() => {
      const t = (x: TransItemType, vars?: any) => {
        return this.i18n.t(x, vars);
      };
      this.registerEvent(
        this.app.workspace.on("file-menu", (menu, file) => {
          if (file instanceof TFolder) {
            // folder not supported yet
            return;
          }

          menu.addItem((item) => {
            item
              .setTitle(t("menu_check_file_stat"))
              .setIcon("file-cog")
              .onClick(async () => {
                const filePath = file.path;
                const fsLocal = new FakeFsLocal(
                  this.app.vault,
                  this.settings.syncConfigDir ?? false,
                  this.settings.syncBookmarks ?? false,
                  this.app.vault.configDir,
                  this.manifest.id,
                  undefined,
                  this.settings.deleteToWhere ?? "system"
                );
                const s = await fsLocal.stat(filePath);
                new Notice(JSON.stringify(s, null, 2), 10000);
              });
          });
        })
      );
    });
  }

  async saveAgreeToUseNewSyncAlgorithm() {
    this.settings.agreeToUseSyncV3 = true;
    await this.saveSettings();
  }

  setCurrSyncMsg(
    t: (x: TransItemType, vars?: any) => string,
    s: SyncTriggerSourceType,
    i: number,
    totalCount: number,
    pathName: string,
    decision: string,
    triggerSource: SyncTriggerSourceType
  ) {
    const L = `${totalCount}`.length;
    const iStr = `${i}`.padStart(L, "0");
    const prefix = getStatusBarShortMsgFromSyncSource(t, s);
    const shortMsg = prefix + `Syncing ${iStr}/${totalCount}`;
    const longMsg =
      prefix +
      `Syncing progress=${iStr}/${totalCount},decision=${decision},path=${pathName},source=${triggerSource}`;
    this.currSyncMsg = longMsg;

    if (this.statusBarElement !== undefined) {
      this.statusBarElement.setText(shortMsg);
      this.statusBarElement.setAttribute("aria-label", longMsg);
    }
  }

  updateLastSyncMsg(
    s: SyncTriggerSourceType | undefined,
    syncStatus: "not_syncing" | "syncing",
    lastSuccessSyncMillis: number | null | undefined,
    lastFailedSyncMillis: number | null | undefined
  ) {
    if (this.statusBarElement === undefined) return;

    // console.debug(lastSuccessSyncMillis);
    // console.debug(lastFailedSyncMillis);

    const t = (x: TransItemType, vars?: any) => {
      return this.i18n.t(x, vars);
    };

    let lastSyncMsg = t("statusbar_lastsync_never");
    let lastSyncLabelMsg = t("statusbar_lastsync_never_label");

    const inputTs = Math.max(
      lastSuccessSyncMillis ?? -999,
      lastFailedSyncMillis ?? -999
    );
    const isSuccess =
      (lastSuccessSyncMillis ?? -999) >= (lastFailedSyncMillis ?? -999);

    if (syncStatus === "syncing") {
      lastSyncMsg =
        getStatusBarShortMsgFromSyncSource(t, s!) + t("statusbar_syncing");
    } else if (inputTs > 0) {
      let prefix = "";
      if (isSuccess) {
        prefix = t("statusbar_sync_status_prefix_success");
      } else {
        prefix = t("statusbar_sync_status_prefix_failed");
      }

      const deltaTime = Date.now() - inputTs;
      // create human readable time
      const years = Math.floor(deltaTime / 31556952000);
      const months = Math.floor(deltaTime / 2629746000);
      const weeks = Math.floor(deltaTime / 604800000);
      const days = Math.floor(deltaTime / 86400000);
      const hours = Math.floor(deltaTime / 3600000);
      const minutes = Math.floor(deltaTime / 60000);
      const seconds = Math.floor(deltaTime / 1000);
      let timeText = "";
      if (years > 0) {
        timeText = t("statusbar_time_years", { time: years });
      } else if (months > 0) {
        timeText = t("statusbar_time_months", { time: months });
      } else if (weeks > 0) {
        timeText = t("statusbar_time_weeks", { time: weeks });
      } else if (days > 0) {
        timeText = t("statusbar_time_days", { time: days });
      } else if (hours > 0) {
        timeText = t("statusbar_time_hours", { time: hours });
      } else if (minutes > 0) {
        timeText = t("statusbar_time_minutes", { time: minutes });
      } else if (seconds > 30) {
        timeText = t("statusbar_time_lessminute");
      } else {
        timeText = t("statusbar_time_now");
      }
      const dateText = new Date(inputTs).toLocaleTimeString(
        navigator.language,
        {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      );

      lastSyncMsg = prefix + timeText;
      lastSyncLabelMsg =
        prefix + t("statusbar_lastsync_label", { date: dateText });
    } else {
      // TODO: no idea what happened.
    }

    this.statusBarElement.setText(lastSyncMsg);
    this.statusBarElement.setAttribute("aria-label", lastSyncLabelMsg);
  }

  /**
   * Because data.json contains sensitive information,
   * We usually want to ignore it in the version control.
   * However, if there's already a an ignore file (even empty),
   * we respect the existing configure and not add any modifications.
   * @returns
   */
  async tryToAddIgnoreFile() {
    const pluginConfigDir =
      this.manifest.dir ||
      `${this.app.vault.configDir}/plugins/${this.manifest.dir}`;
    const pluginConfigDirExists =
      await this.app.vault.adapter.exists(pluginConfigDir);
    if (!pluginConfigDirExists) {
      // what happened?
      return;
    }
    const ignoreFile = `${pluginConfigDir}/.gitignore`;
    const ignoreFileExists = await this.app.vault.adapter.exists(ignoreFile);

    const contentText = "data.json\n";

    try {
      if (!ignoreFileExists) {
        // not exists, directly create
        // no need to await
        this.app.vault.adapter.write(ignoreFile, contentText);
      }
    } catch (error) {
      // just skip
    }
  }

  enableAutoClearOutputToDBHistIfSet() {
    const initClearOutputToDBHistAfterMilliseconds = 1000 * 30;

    this.app.workspace.onLayoutReady(() => {
      // init run
      window.setTimeout(() => {
        clearAllLoggerOutputRecords(this.db);
      }, initClearOutputToDBHistAfterMilliseconds);
    });
  }

  enableAutoClearSyncPlanHist() {
    const initClearSyncPlanHistAfterMilliseconds = 1000 * 45;
    const autoClearSyncPlanHistAfterMilliseconds = 1000 * 60 * 5;

    this.app.workspace.onLayoutReady(() => {
      // init run
      window.setTimeout(() => {
        clearExpiredSyncPlanRecords(this.db);
      }, initClearSyncPlanHistAfterMilliseconds);

      // scheduled run
      const intervalID = window.setInterval(() => {
        clearExpiredSyncPlanRecords(this.db);
      }, autoClearSyncPlanHistAfterMilliseconds);
      this.registerInterval(intervalID);
    });
  }
}
