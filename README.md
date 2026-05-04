# Anotum Obsidian Sync

[Anotum](https://anotum.com) is a comprehensive reading intelligence platform designed to capture, centralize, and organize insights from your entire library.

This official plugin provides a seamless bridge between your Anotum library and your [Obsidian](https://obsidian.md) vault, turning your highlights into active, searchable Markdown notes.

## Disclosures
An anotum account with an active trial or a subscription are required to use this plugin.
This plugin communicates solely with `https://api.anotum.com` and only to pull your highlights.
We do not collect any telemetry via this plugin.

You can read our full privacy policy [here](https://anotum.com/privacy) and our terms of service [here](https://anotum.com/terms).

## How to use

This plugin requires an active subscription or a trial to anotum. Once the plugin is installed, go into the settings and select "Anotum Account: Connect".
This will direct you to anotum.com, from where you will have to name the connection and then you'll be redirected back to Obsidian.
At this point your highlights will automatically begin syncing, but you can also select "Manual sync: Sync now" to force sync.

## Template

By default the plugin will sync your highlights with the following template:
```markdown
**{{ date | formatDate }}** — #{{ color }}

{{ highlight }} ^hl-{{ id }}{% if note %}

**You left a note:** {{ note }}{% endif %}

---
```

You are able to customize this template however you desire. It supports the following options:
 - **Variables**: `{{ highlight }}`, `{{ color }}`, `{{ id }}`, `{{ note }}`, `{{ chapter }}`, `{{ index }}`.
 - **Filter**: `{{ date | formatDate }}`.
Use `{% if note %} {{ note }} {% endif %}` to embed notes inside the block.
Additionally we recommend including `^hl-{{ id }}` so obsidian can link to the block.
