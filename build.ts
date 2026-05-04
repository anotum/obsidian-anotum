import { watch } from "fs";
import { join } from "path";

const isProd = Bun.argv.includes("--production");
const devOutdir = "./.obsidian/plugins/anotum-sync";
const outdir = isProd ? "." : devOutdir;

async function build() {
	const result = await Bun.build({
		entrypoints: ["./src/main.ts"],
		outdir,
		external: ["obsidian"],
		format: "cjs",
		target: "browser",
		minify: isProd,
		sourcemap: isProd ? "none" : "inline",
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		return false;
	}

	if (!isProd) {
		await Bun.write(`${devOutdir}/manifest.json`, Bun.file("./manifest.json"));
	}

	console.log(`Built at ${new Date().toLocaleTimeString()}`);
	return true;
}

const success = await build();

if (!isProd) {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const rebuild = () => {
		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(() => build(), 100);
	};

	watch(join(import.meta.dir, "src"), { recursive: true }, rebuild);
	console.log("Watching src/ for changes...");
} else if (!success) {
	process.exit(1);
}
