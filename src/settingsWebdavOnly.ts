import { PluginSettingTab, Setting, type App, type ButtonComponent } from "obsidian";
import type RemotelySavePlugin from "./main";
import { getClient } from "./fsGetter";

export class RemotelySaveSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: RemotelySavePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const t = this.plugin.i18n.t.bind(this.plugin.i18n);
    const config = this.plugin.settings.webdav;
    const vaultName = this.app.vault.getName();
    containerEl.empty();
    containerEl.addClass("rsh-settings");

    const hero = containerEl.createDiv({ cls: "rsh-hero" });
    hero.createDiv({ cls: "rsh-eyebrow", text: t("webdav_only_eyebrow") });
    hero.createEl("h1", { text: "Remotely Save HTTP" });
    hero.createEl("p", { text: t("webdav_only_intro") });

    const card = (title: string, description: string): HTMLDivElement => {
      const outer = containerEl.createDiv({ cls: "rsh-card" });
      const header = outer.createDiv({ cls: "rsh-card-heading" });
      header.createEl("h2", { text: title });
      header.createEl("p", { text: description });
      return outer.createDiv({ cls: "rsh-card-content" });
    };
    const addressError = (): string | null => {
      if (!config.address) return t("webdav_only_missing_address");
      try {
        const url = new URL(config.address);
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) return null;
      } catch { /* Invalid URL. */ }
      return t("webdav_only_invalid_address");
    };

    const connection = card(t("webdav_only_connection"), t("webdav_only_connection_desc"));
    new Setting(connection).setName(t("settings_webdav_addr"))
      .setDesc(t("settings_webdav_addr_desc"))
      .addText((input) => input.setPlaceholder("http://host:port/dav")
        .setValue(config.address).onChange(async (value) => {
          config.address = value.trim();
          changed();
          await this.plugin.saveSettings();
        })).settingEl.addClass("rsh-address-row");
    const credentials = connection.createDiv({ cls: "rsh-credentials" });
    new Setting(credentials).setName(t("settings_webdav_user"))
      .addText((input) => input.setValue(config.username).onChange(async (value) => {
        config.username = value.trim();
        changed();
        await this.plugin.saveSettings();
      }));
    new Setting(credentials).setName(t("settings_webdav_password"))
      .addText((input) => {
        input.inputEl.type = "password";
        input.setValue(config.password).onChange(async (value) => {
          config.password = value;
          changed();
          await this.plugin.saveSettings();
        });
      });

    const destination = card(t("webdav_only_destination"), t("webdav_only_destination_desc"));
    new Setting(destination).setName(t("webdav_only_folder"))
      .setDesc(t("webdav_only_folder_hint"))
      .addText((input) => input.setPlaceholder(vaultName)
        .setValue(config.remoteBaseDir ?? "").onChange(async (value) => {
          config.remoteBaseDir = value.trim();
          updatePath();
          changed();
          await this.plugin.saveSettings();
        }));
    destination.createDiv({ cls: "rsh-preview-label", text: t("webdav_only_path_preview") });
    const pathPreview = destination.createDiv({ cls: "rsh-path-preview" });
    const updatePath = () => pathPreview.setText(`/${config.remoteBaseDir || vaultName}/`);
    updatePath();

    const schedule = card(t("webdav_only_schedule"), t("webdav_only_schedule_desc"));
    new Setting(schedule).setName(t("webdav_only_schedule_interval"))
      .setDesc(t("webdav_only_schedule_hint"))
      .addDropdown((dropdown) => dropdown
        .addOption("-1", t("webdav_only_schedule_off"))
        .addOption("5", t("webdav_only_schedule_5sec"))
        .addOption("15", t("webdav_only_schedule_15sec"))
        .addOption("60", t("webdav_only_schedule_1min"))
        .addOption("300", t("webdav_only_schedule_5min"))
        .setValue(String(this.plugin.settings.scheduledMergeIntervalSeconds ?? 5))
        .onChange(async (value) => {
          this.plugin.settings.scheduledMergeIntervalSeconds = Number(value);
          await this.plugin.saveSettings();
          this.plugin.configureScheduledMerge();
        }));

    const advanced = containerEl.createEl("details", { cls: "rsh-card rsh-advanced" });
    advanced.createEl("summary", { text: t("webdav_only_advanced") });
    const advancedContent = advanced.createDiv({ cls: "rsh-card-content" });
    advancedContent.createEl("p", { cls: "rsh-advanced-description", text: t("webdav_only_advanced_desc") });
    new Setting(advancedContent).setName(t("settings_webdav_auth"))
      .addDropdown((dropdown) => dropdown.addOption("basic", "Basic").addOption("digest", "Digest")
        .setValue(config.authType).onChange(async (value) => {
          config.authType = value as "basic" | "digest";
          changed();
          await this.plugin.saveSettings();
        }));
    new Setting(advancedContent).setName(t("settings_webdav_depth"))
      .addDropdown((dropdown) => dropdown
        .addOption("manual_1", t("settings_webdav_depth_1"))
        .addOption("manual_infinity", t("settings_webdav_depth_inf"))
        .setValue(config.depth ?? "manual_1").onChange(async (value) => {
          config.depth = value as "manual_1" | "manual_infinity";
          config.manualRecursive = value === "manual_1";
          changed();
          await this.plugin.saveSettings();
        }));
    new Setting(advancedContent).setName(t("settings_webdav_customheaders"))
      .setDesc(t("webdav_only_headers_hint"))
      .addTextArea((input) => input.setValue(config.customHeaders ?? "").onChange(async (value) => {
        config.customHeaders = value.trim();
        changed();
        await this.plugin.saveSettings();
      }));

    const actions = card(t("webdav_only_actions"), t("webdav_only_actions_desc"));
    const status = actions.createDiv({ cls: "rsh-status" });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const buttons = actions.createDiv({ cls: "rsh-actions" });
    let checkButton: ButtonComponent;
    let syncButton: ButtonComponent;
    let busy = false;
    let changeId = 0;
    const setStatus = (state: string, message: string) => {
      status.dataset.state = state;
      status.setText(message);
    };
    const updateButtons = () => {
      const disabled = busy || addressError() !== null;
      checkButton.setDisabled(disabled);
      syncButton.setDisabled(disabled);
    };
    const changed = () => {
      changeId++;
      const error = addressError();
      setStatus(error ? "warning" : "idle", error || t("webdav_only_ready"));
      updateButtons();
    };
    new Setting(buttons).addButton((button) => {
      checkButton = button;
      button.setButtonText(t("webdav_only_check_button")).onClick(async () => {
        if (busy || addressError()) return;
        busy = true;
        const startedAt = changeId;
        setStatus("checking", t("webdav_only_checking"));
        updateButtons();
        try {
          const client = getClient(this.plugin.settings, vaultName, () => this.plugin.saveSettings());
          let error = "";
          const ok = await client.checkConnect((err: unknown) => { error = String(err); });
          if (startedAt === changeId) setStatus(ok ? "success" : "error", ok
            ? t("webdav_only_connected")
            : `${t("webdav_only_failed")}${error ? `: ${error}` : ""}`);
        } catch (err) {
          if (startedAt === changeId) setStatus("error", `${t("webdav_only_failed")}: ${String(err)}`);
        } finally {
          busy = false;
          updateButtons();
        }
      });
    });
    new Setting(buttons).addButton((button) => {
      syncButton = button;
      button.setButtonText(t("webdav_only_sync_button")).setCta().onClick(async () => {
        if (busy || addressError()) return;
        busy = true;
        status.hidden = true;
        updateButtons();
        try {
          await this.plugin.syncRun("manual");
        } finally {
          busy = false;
          status.hidden = false;
          changed();
        }
      });
    });
    changed();
  }
}
