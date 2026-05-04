import type { PluginSettings } from "./types";

export const DEFAULT_HIGHLIGHT_TEMPLATE = `**{{ date | formatDate }}** — #{{ color }}

{{ highlight }} ^hl-{{ id }}{% if note %}

**You left a note:** {{ note }}{% endif %}

---`;

export const DEFAULT_SETTINGS: PluginSettings = {
	sync_interval_minutes: 15,
	folder_name: "Anotum",
	dev_mode: false,
	highlight_template: DEFAULT_HIGHLIGHT_TEMPLATE,
	dev_api_url: "",
	dev_frontend_url: "",
};

export const API_URL = "https://api.anotum.com/graphql";
export const AUTH_URL = "https://anotum.com";

export const PAGE_SIZE = 20;
export const MAX_RETRIES = 3;
export const BASE_BACKOFF_MS = 1000;
