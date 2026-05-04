import type { AnnotationChange, Annotation, Book, PluginState } from "../types";
import type { ApiClient } from "../api/graphql";
import type { VaultManager } from "../obsidian/vault";
import type { TFile } from "obsidian";
import * as parser from "../markdown/parser";

type BookChanges = {
	book: Book;
	upserts: Annotation[];
	deletes: string[];
};

export class SyncEngine {
	constructor(
		private api: ApiClient,
		private vault: VaultManager,
	) {}

	async execute(state: PluginState): Promise<string | null> {
		const { changes, endCursor } = await this.api.fetchAllChanges(
			state.sync_state.last_cursor,
		);

		if (changes.length === 0) {
			return endCursor;
		}

		await this.vault.ensureFolder();
		const bookIndex = await this.vault.buildBookIndex();
		const template = state.settings.highlight_template;

		await Promise.all(
			[...this.groupByBook(changes).values()].map((bc) =>
				this.syncBook(bc, bookIndex, template),
			),
		);

		return endCursor;
	}

	private groupByBook(changes: AnnotationChange[]): Map<string, BookChanges> {
		const byBook = Map.groupBy(
			changes.filter((c) => c.annotation !== null),
			(c) => c.annotation!.book.id,
		);
		return new Map(
			[...byBook.entries()].map(([bookId, grouped]) => [
				bookId,
				{
					book: grouped[0].annotation!.book,
					upserts: grouped
						.filter((c) => c.action === "UPSERT")
						.map((c) => c.annotation!),
					deletes: grouped
						.filter((c) => c.action === "DELETE")
						.map((c) => c.id),
				},
			]),
		);
	}

	private async syncBook(
		bookChanges: BookChanges,
		bookIndex: Map<string, TFile>,
		template: string,
	): Promise<void> {
		const existingFile = bookIndex.get(bookChanges.book.id);

		if (existingFile) {
			const content = parser.updateLastSynced(
				this.applyChanges(
					await this.vault.readFile(existingFile),
					bookChanges,
					template,
				),
			);
			await this.vault.writeFile(existingFile, content);
			return;
		}

		if (bookChanges.upserts.length > 0) {
			const sorted = [...bookChanges.upserts].sort((a, b) => a.index - b.index);
			await this.vault.createFile(
				`${this.vault.sanitizeFileName(bookChanges.book.title)}.md`,
				parser.generateBookFile(bookChanges.book, sorted, template),
			);
		}
	}

	private applyChanges(
		content: string,
		{ upserts, deletes }: BookChanges,
		template: string,
	): string {
		const afterDeletes = deletes.reduce((acc, id) => {
			const chapter = parser.extractHighlightChapter(acc, id);
			const withoutNote = parser.removeNoteBlock(
				parser.tombstoneHighlight(acc, id),
				id,
			);
			return chapter
				? parser.removeChapterHeadingIfEmpty(withoutNote, chapter)
				: withoutNote;
		}, content);

		return upserts.reduce((acc, annotation) => {
			const updated = parser.hasHighlightBlock(acc, annotation.id)
				? parser.updateHighlightBlock(acc, annotation.id, annotation, template)
				: parser.insertHighlightIntoChapter(acc, annotation, template);
			return parser.removeNoteBlock(updated, annotation.id);
		}, afterDeletes);
	}
}
