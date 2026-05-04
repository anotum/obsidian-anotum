import { App, TFile, TFolder, normalizePath } from "obsidian";
import sanitizeFilename from "sanitize-filename";
import { extractBookId } from "../markdown/parser";

export class VaultManager {
	constructor(
		private app: App,
		private folderName: string,
	) {}

	private get folderPath(): string {
		return normalizePath(this.folderName);
	}

	async ensureFolder(): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(this.folderPath);
		if (!existing) {
			await this.app.vault.createFolder(this.folderPath);
		}
	}

	getBookFiles(): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
		if (!(folder instanceof TFolder)) return [];
		return folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "md",
		);
	}

	async buildBookIndex(): Promise<Map<string, TFile>> {
		const index = new Map<string, TFile>();
		const files = this.getBookFiles();

		for (const file of files) {
			const content = await this.readFile(file);
			const bookId = extractBookId(content);
			if (bookId) index.set(bookId, file);
		}

		return index;
	}

	async readFile(file: TFile): Promise<string> {
		const content = await this.app.vault.read(file);
		return content.replace(/\r\n/g, "\n");
	}

	async writeFile(file: TFile, content: string): Promise<void> {
		await this.app.vault.modify(file, content);
	}

	async createFile(fileName: string, content: string): Promise<TFile> {
		const path = normalizePath(`${this.folderName}/${fileName}`);
		return this.app.vault.create(path, content);
	}

	sanitizeFileName(title: string): string {
		const sanitized = sanitizeFilename(title, { replacement: "-" }).trim();
		return sanitized.length > 0 ? sanitized : "Untitled";
	}
}
