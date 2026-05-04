import { PluginSettingTab, App, Setting } from "obsidian";
import type AnotumPlugin from "./main";

export class AnotumSettingsTab extends PluginSettingTab {
	plugin: AnotumPlugin;

	constructor(app: App, plugin: AnotumPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const isAuthenticated = this.plugin.state.auth !== null;

		new Setting(containerEl)
			.setName("Anotum account")
			.setDesc(isAuthenticated ? "Connected to Anotum" : "Not connected")
			.addButton((btn) => {
				if (isAuthenticated) {
					btn.setButtonText("Disconnect").onClick(async () => {
						this.plugin.state.auth = null;
						await this.plugin.saveState();
						this.display();
					});
				} else {
					btn
						.setButtonText("Connect to Anotum")
						.setCta()
						.onClick(() => {
							const callback = encodeURIComponent("obsidian://anotum-auth");
							window.open(
								`${this.plugin.authUrl}/connect?callback=${callback}&role=api_read`,
							);
						});
				}
			});

		new Setting(containerEl)
			.setName("Sync interval")
			.setDesc("Minutes between automatic syncs")
			.addText((text) =>
				text
					.setValue(String(this.plugin.state.settings.sync_interval_minutes))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.state.settings.sync_interval_minutes = num;
							await this.plugin.saveState();
							this.plugin.restartSyncInterval();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Folder name")
			.setDesc("Vault folder where books are synced")
			.addText((text) =>
				text
					.setValue(this.plugin.state.settings.folder_name)
					.onChange(async (value) => {
						if (value.trim()) {
							this.plugin.state.settings.folder_name = value.trim();
							await this.plugin.saveState();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Highlight template")
			.setDesc(
				"Template for each highlight. " +
					"Variables: {{ highlight }}, {{ color }}, {{ id }}, {{ note }}, {{ chapter }}, {{ index }}. " +
					"Filter: {{ date | formatDate }}. " +
					"Use {% if note %}\\n{{ note }}{% endif %} to embed notes inside the block. " +
					"Include ^hl-{{ id }} so obsidian can link to the block.",
			)
			.addTextArea((text) => {
				text.inputEl.rows = 8;
				text.inputEl.style.width = '100%';
				return text
					.setValue(this.plugin.state.settings.highlight_template)
					.onChange(async (value) => {
						if (value.includes("highlight")) {
							this.plugin.state.settings.highlight_template = value;
							await this.plugin.saveState();
						}
					});
			});

		new Setting(containerEl)
			.setName("Development mode")
			.setDesc("Use local development server instead of production")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.state.settings.dev_mode)
					.onChange(async (value) => {
						this.plugin.state.settings.dev_mode = value;
						await this.plugin.saveState();
						this.display();
					})
			);
		if (this.plugin.state.settings.dev_mode) {
			new Setting(containerEl)
				.setName("Dev API URL")
				.addText((text) => text
					.setValue(this.plugin.state.settings.dev_api_url)
					.onChange(async (value) => {
						this.plugin.state.settings.dev_api_url = value;
						await this.plugin.saveState();
					}));
			new Setting(containerEl)
				.setName("Dev Frontend URL")
				.addText((text) => text
					.setValue(this.plugin.state.settings.dev_frontend_url)
					.onChange(async (value) => {
						this.plugin.state.settings.dev_frontend_url = value;
						await this.plugin.saveState();
					}));
		}

		if (isAuthenticated) {
			new Setting(containerEl)
				.setName("Manual sync")
				.setDesc("Trigger a sync now")
				.addButton((btn) =>
					btn.setButtonText("Sync now").onClick(async () => {
						await this.plugin.runSync();
					}),
				);

			new Setting(containerEl)
				.setName("Reset sync cursor")
				.setDesc(
					"Clear the sync cursor so the next sync re-fetches all highlights from the beginning.",
				)
				.addButton((btn) =>
					btn
						.setButtonText("Reset cursor")
						.setWarning()
						.onClick(async () => {
							this.plugin.state.sync_state.last_cursor = null;
							await this.plugin.saveState();
						}),
				);
		}
	}
}
