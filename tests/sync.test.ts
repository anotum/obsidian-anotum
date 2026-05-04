import { describe, test, expect, mock } from "bun:test";
import sanitizeFilename from "sanitize-filename";
import type {
	Annotation,
	AnnotationChange,
	Book,
	PluginState,
} from "../src/types";
import { SyncEngine } from "../src/sync/engine";
import { DEFAULT_HIGHLIGHT_TEMPLATE } from "../src/constants";

const mockBook: Book = {
	id: "book_1",
	title: "Test Book",
	authors: ["Author"],
	categories: ["Category"],
};

// Millisecond timestamp for 2022-01-01T00:00:00Z
const TEST_DATE = 1640995200000;
const TEST_DATE_FMT = "1 January, 2022";

function createAnnotation(overrides: Partial<Annotation> = {}): Annotation {
	return {
		id: "hl_1",
		index: 0,
		date: TEST_DATE,
		chapter: "Chapter 1",
		highlight: "Test highlight text",
		highlightEdit: null,
		color: "yellow",
		note: "",
		book: mockBook,
		...overrides,
	};
}

function createChange(
	action: "UPSERT" | "DELETE",
	annotation: Annotation,
): AnnotationChange {
	return { id: annotation.id, action, annotation };
}

function createMockVault(files: Map<string, string> = new Map()) {
	const written = new Map<string, string>();
	const created = new Map<string, string>();

	return {
		ensureFolder: mock(() => Promise.resolve()),
		buildBookIndex: mock(() => {
			const index = new Map<string, { path: string }>();
			for (const [path, content] of files) {
				const match = content.match(/anotum_book_id:\s*"?([^"\n]+)"?/);
				if (match) index.set(match[1], { path } as never);
			}
			return Promise.resolve(index);
		}),
		readFile: mock((file: { path: string }) =>
			Promise.resolve(files.get(file.path) ?? ""),
		),
		writeFile: mock((file: { path: string }, content: string) => {
			written.set(file.path, content);
			return Promise.resolve();
		}),
		createFile: mock((fileName: string, content: string) => {
			created.set(fileName, content);
			return Promise.resolve({ path: fileName } as never);
		}),
		sanitizeFileName: (title: string) => {
			const s = sanitizeFilename(title, { replacement: "-" }).trim();
			return s.length > 0 ? s : "Untitled";
		},
		_written: written,
		_created: created,
	};
}

function createMockApi(
	changes: AnnotationChange[],
	endCursor: string | null = "cursor_1",
) {
	return {
		fetchAllChanges: mock(() => Promise.resolve({ changes, endCursor })),
	};
}

const defaultState: PluginState = {
	auth: {
		access_token: "token",
		refresh_token: "refresh",
		expires_at: Date.now() + 60000,
	},
	sync_state: { last_cursor: null },
	settings: {
		sync_interval_minutes: 15,
		folder_name: "Anotum",
		dev_mode: false,
		highlight_template: DEFAULT_HIGHLIGHT_TEMPLATE,
		dev_api_url: "",
		dev_frontend_url: "",
	},
};

function makeExistingFile(extras: string[] = []): string {
	return [
		"---",
		'anotum_book_id: "book_1"',
		'title: "Test Book"',
		'last_synced: "2020-01-01T00:00:00Z"',
		"---",
		"",
		"%% anotum-chapter: Chapter 1 %%",
		"## Chapter 1",
		"",
		"%% anotum-hl-start: hl_1 %%",
		`**${TEST_DATE_FMT}** — #yellow`,
		"First highlight ^hl-hl_1",
		"",
		"%% anotum-hl-end: hl_1 %%",
		"",
		"---",
		...extras,
	].join("\n");
}

describe("SyncEngine", () => {
	test("creates new file with correct filename", async () => {
		const api = createMockApi([createChange("UPSERT", createAnnotation())]);
		const vault = createMockVault();
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		expect(vault.createFile).toHaveBeenCalledTimes(1);
		const [fileName, content] = vault.createFile.mock.calls[0] as [
			string,
			string,
		];
		expect(fileName).toBe("Test Book.md");
		expect(content).toContain("book_1");
		expect(content).toContain("%% anotum-hl-start: hl_1 %%");
		expect(content).toContain("Test highlight text ^hl-hl_1");
		// Block ID must never be on its own standalone line
		expect(content).not.toMatch(/\n\^hl-/);
	});

	test("new file: two highlights in same chapter produce one chapter heading", async () => {
		const api = createMockApi([
			createChange("UPSERT", createAnnotation({ id: "hl_1", index: 0 })),
			createChange("UPSERT", createAnnotation({ id: "hl_2", index: 1 })),
		]);
		const vault = createMockVault();
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const [, content] = vault.createFile.mock.calls[0] as [string, string];
		expect((content.match(/## Chapter 1/g) ?? []).length).toBe(1);
	});

	test("new file: two highlights separated by ---", async () => {
		const api = createMockApi([
			createChange("UPSERT", createAnnotation({ id: "hl_1", index: 0 })),
			createChange("UPSERT", createAnnotation({ id: "hl_2", index: 1 })),
		]);
		const vault = createMockVault();
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const [, content] = vault.createFile.mock.calls[0] as [string, string];
		const hl2Start = content.indexOf("%% anotum-hl-start: hl_2 %%");
		const hl2End = content.indexOf("%% anotum-hl-end: hl_2 %%");
		expect(content.slice(hl2Start, hl2End)).toContain("---");
	});

	test("updates existing highlight text and color", async () => {
		const files = new Map([["Book.md", makeExistingFile()]]);
		const updated = createAnnotation({ highlight: "New text", color: "blue" });
		const api = createMockApi([createChange("UPSERT", updated)]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("New text ^hl-hl_1");
		expect(written).not.toContain("First highlight");
		expect(written).not.toMatch(/\n\^hl-/);
	});

	test("appends new highlight into existing chapter without extra heading", async () => {
		const files = new Map([["Book.md", makeExistingFile()]]);
		const newHl = createAnnotation({
			id: "hl_2",
			index: 1,
			highlight: "Second",
		});
		const api = createMockApi([createChange("UPSERT", newHl)]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("%% anotum-hl-start: hl_1 %%");
		expect(written).toContain("%% anotum-hl-start: hl_2 %%");
		expect((written.match(/## Chapter 1/g) ?? []).length).toBe(1);
		const hl2Start = written.indexOf("%% anotum-hl-start: hl_2 %%");
		const hl2End = written.indexOf("%% anotum-hl-end: hl_2 %%");
		expect(written.slice(hl2Start, hl2End)).toContain("---");
	});

	test("appends new highlight in new chapter with its own heading", async () => {
		const files = new Map([["Book.md", makeExistingFile()]]);
		const newHl = createAnnotation({
			id: "hl_2",
			index: 0,
			chapter: "Chapter 2",
		});
		const api = createMockApi([createChange("UPSERT", newHl)]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("## Chapter 1");
		expect(written).toContain("## Chapter 2");
		expect(written.indexOf("## Chapter 2")).toBeGreaterThan(
			written.indexOf("## Chapter 1"),
		);
	});

	test("tombstones deleted highlight and removes its note", async () => {
		const withNote = makeExistingFile([
			"",
			"%% anotum-note-start: hl_1 %%",
			"My note ^note-hl_1",
			"",
			"%% anotum-note-end: hl_1 %%",
		]);
		const files = new Map([["Book.md", withNote]]);
		const api = createMockApi([createChange("DELETE", createAnnotation())]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("[Deleted in Anotum]");
		expect(written).not.toContain("First highlight");
		expect(written).not.toContain("anotum-note-start");
	});

	test("deleting the only highlight in a chapter removes the chapter heading", async () => {
		const files = new Map([["Book.md", makeExistingFile()]]);
		const api = createMockApi([createChange("DELETE", createAnnotation())]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).not.toContain("%% anotum-chapter: Chapter 1 %%");
		expect(written).not.toContain("## Chapter 1");
	});

	test("deleting one of two highlights keeps the chapter heading", async () => {
		const twoHighlights = makeExistingFile([
			"",
			"---",
			"",
			"%% anotum-hl-start: hl_2 %%",
			`**${TEST_DATE_FMT}** — #yellow`,
			"Second highlight ^hl-hl_2",
			"",
			"%% anotum-hl-end: hl_2 %%",
		]);
		const files = new Map([["Book.md", twoHighlights]]);
		const api = createMockApi([createChange("DELETE", createAnnotation())]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("%% anotum-chapter: Chapter 1 %%");
		expect(written).toContain("## Chapter 1");
		expect(written).toContain("%% anotum-hl-start: hl_2 %%");
	});

	test("note insertion on new annotation", async () => {
		const api = createMockApi([
			createChange("UPSERT", createAnnotation({ note: "Important note" })),
		]);
		const vault = createMockVault();
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		const [, content] = vault.createFile.mock.calls[0] as [string, string];
		expect(content).toContain("Important note");
		expect(content).not.toContain("%% anotum-note-start:");
		const hlStart = content.indexOf("%% anotum-hl-start: hl_1 %%");
		const hlEnd = content.indexOf("%% anotum-hl-end: hl_1 %%");
		const notePos = content.indexOf("Important note");
		expect(notePos).toBeGreaterThan(hlStart);
		expect(notePos).toBeLessThan(hlEnd);
	});

	test("returns cursor when no changes", async () => {
		const api = createMockApi([], "cursor_1");
		const vault = createMockVault();
		const cursor = await new SyncEngine(api as never, vault as never).execute(
			defaultState,
		);

		expect(cursor).toBe("cursor_1");
		expect(vault.createFile).not.toHaveBeenCalled();
		expect(vault.writeFile).not.toHaveBeenCalled();
	});

	test("batches multiple changes into a single write per file", async () => {
		const files = new Map([["Book.md", makeExistingFile()]]);
		const api = createMockApi([
			createChange("UPSERT", createAnnotation({ highlight: "Updated" })),
			createChange(
				"UPSERT",
				createAnnotation({
					id: "hl_2",
					index: 0,
					chapter: "Chapter 2",
					highlight: "Brand new",
				}),
			),
		]);
		const vault = createMockVault(files);
		await new SyncEngine(api as never, vault as never).execute(defaultState);

		expect(vault.writeFile).toHaveBeenCalledTimes(1);
		const written = vault.writeFile.mock.calls[0]![1] as string;
		expect(written).toContain("Updated ^hl-hl_1");
		expect(written).toContain("%% anotum-hl-start: hl_2 %%");
	});
});
