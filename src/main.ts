import { Plugin, Notice } from "obsidian";
import type { PluginState, AuthState } from "./types";
import { DEFAULT_SETTINGS, API_URL, AUTH_URL } from "./constants";
import { getExpiresAt } from "./auth/jwt";
import { ApiClient } from "./api/graphql";
import { VaultManager } from "./obsidian/vault";
import { SyncEngine } from "./sync/engine";
import { AnotumSettingsTab } from "./settings";

const DEFAULT_STATE: PluginState = {
	auth: null,
	sync_state: { last_cursor: null },
	settings: { ...DEFAULT_SETTINGS },
};

export default class AnotumPlugin extends Plugin {
	state: PluginState = { ...DEFAULT_STATE };
	private syncIntervalId: number | null = null;

	get apiUrl(): string {
		return this.state.settings.dev_mode && this.state.settings.dev_api_url
			? this.state.settings.dev_api_url
			: API_URL;
	}

	get authUrl(): string {
		return this.state.settings.dev_mode && this.state.settings.dev_frontend_url
			? this.state.settings.dev_frontend_url
			: AUTH_URL;
	}

	async onload(): Promise<void> {
		await this.loadState();

		this.registerObsidianProtocolHandler("anotum-auth", (params) => {
			this.handleAuthCallback(params).catch((e) => {
				console.error("Anotum auth callback failed:", e);
				new Notice("Anotum authentication failed");
			});
		});

		this.addSettingTab(new AnotumSettingsTab(this.app, this));

		this.addCommand({
			id: "sync-highlights",
			name: "Sync highlights",
			callback: () => this.runSync(),
		});

		this.startSyncInterval();
	}

	onunload(): void {
		this.stopSyncInterval();
	}

	async loadState(): Promise<void> {
		const data = (await this.loadData()) as Partial<PluginState> | null;
		this.state = {
			auth: data?.auth ?? null,
			sync_state: data?.sync_state ?? { last_cursor: null },
			settings: { ...DEFAULT_SETTINGS, ...data?.settings },
		};
	}

	async saveState(): Promise<void> {
		await this.saveData(this.state);
	}

	private async handleAuthCallback(
		params: Record<string, string>,
	): Promise<void> {
		const { access_token, refresh_token } = params;
		if (!access_token || !refresh_token) {
			new Notice("Anotum authentication failed, missing tokens");
			return;
		}

		try {
			this.state.auth = {
				access_token,
				refresh_token,
				expires_at: getExpiresAt(access_token),
			};
			await this.saveState();
			new Notice("Anotum connected successfully");
		} catch {
			new Notice("Anotum authentication failed, invalid token");
		}
	}

	startSyncInterval(): void {
		this.stopSyncInterval();
		const ms = this.state.settings.sync_interval_minutes * 60 * 1000;
		this.syncIntervalId = window.setInterval(() => { void this.runSync(); }, ms);
		this.registerInterval(this.syncIntervalId);
	}

	restartSyncInterval(): void {
		this.startSyncInterval();
	}

	private stopSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	async runSync(): Promise<void> {
		if (!this.state.auth) {
			new Notice("Anotum not authenticated, please connect first");
			return;
		}

		try {
			const api = new ApiClient(
				this.apiUrl,
				this.state.auth,
				async (newAuth: AuthState) => {
					this.state.auth = newAuth;
					await this.saveState();
				},
			);

			const vault = new VaultManager(this.app, this.state.settings.folder_name);
			const engine = new SyncEngine(api, vault);
			const newCursor = await engine.execute(this.state);

			if (newCursor) {
				this.state.sync_state.last_cursor = newCursor;
			}
			await this.saveState();
			new Notice("Anotum sync complete");
		} catch (e) {
			console.error("Anotum sync failed:", e);
			new Notice("Anotum sync failed, check console for details");
		}
	}
}
