import { describe, test, expect } from "bun:test";
import { parse } from "yaml";
import type { Annotation, Book } from "../src/types";
import * as parser from "../src/markdown/parser";

const mockBook: Book = {
	id: "book_1",
	title: "The Pragmatic Programmer",
	authors: ["David Thomas", "Andrew Hunt"],
	categories: ["Programming", "Technology"],
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
		highlight: "It's your life. You own it.",
		highlightEdit: null,
		color: "yellow",
		note: "",
		book: mockBook,
		...overrides,
	};
}

function parseFrontmatter(fm: string): Record<string, unknown> {
	const yamlContent = fm.replace(/^---\n/, "").replace(/\n---$/, "");
	return parse(yamlContent) as Record<string, unknown>;
}

describe("generateFrontmatter", () => {
	test("produces valid YAML with book metadata", () => {
		const fm = parser.generateFrontmatter(mockBook);
		expect(fm).toMatch(/^---\n/);
		expect(fm).toMatch(/\n---$/);
		const parsed = parseFrontmatter(fm);
		expect(parsed.anotum_book_id).toBe("book_1");
		expect(parsed.title).toBe("The Pragmatic Programmer");
		expect(parsed.author).toEqual(["David Thomas", "Andrew Hunt"]);
		expect(parsed.categories).toEqual(["Programming", "Technology"]);
		expect(parsed.last_synced).toBeDefined();
	});
});

describe("renderHighlight", () => {
	test("renders date via formatDate filter", () => {
		const a = createAnnotation();
		const result = parser.renderHighlight(
			"**{{ date | formatDate }}** — #{{ color }}\n{{ highlight }} ^hl-{{ id }}",
			a,
		);
		expect(result).toBe(
			`**${TEST_DATE_FMT}** — #yellow\nIt's your life. You own it. ^hl-hl_1`,
		);
	});

	test("uses highlightEdit when present", () => {
		const a = createAnnotation({ highlightEdit: "Edited version" });
		expect(parser.renderHighlight("{{ highlight }}", a)).toBe("Edited version");
	});

	test("renders note variable", () => {
		const a = createAnnotation({ note: "my note" });
		const result = parser.renderHighlight(
			"{{ highlight }} ^hl-{{ id }} — {{ note }}",
			a,
		);
		expect(result).toBe("It's your life. You own it. ^hl-hl_1 — my note");
	});

	test("renders note with default 'You left a note' prefix", () => {
		const a = createAnnotation({ note: "great point" });
		const result = parser.renderHighlight(
			"{{ highlight }} ^hl-{{ id }}{% if note %}\n**You left a note:** {{ note }}{% endif %}",
			a,
		);
		expect(result).toContain("**You left a note:** great point");
	});

	test("note block absent when note is empty", () => {
		const a = createAnnotation({ note: "" });
		const result = parser.renderHighlight(
			"{{ highlight }}{% if note %}\n**You left a note:** {{ note }}{% endif %}",
			a,
		);
		expect(result).not.toContain("You left a note");
	});

	test("default template produces bold date line then highlight line", () => {
		const a = createAnnotation({ color: "blue" });
		const result = parser.renderHighlight(
			"**{{ date | formatDate }}** — #{{ color }}\n{{ highlight }}",
			a,
		);
		const lines = result.split("\n");
		expect(lines[0]).toBe(`**${TEST_DATE_FMT}** — #blue`);
		expect(lines[1]).toBe("It's your life. You own it.");
	});
});

describe("generateHighlightBlock", () => {
	test("block ID is inline on the last content line, not a standalone line", () => {
		const block = parser.generateHighlightBlock(createAnnotation());
		const lines = block.split("\n");
		// No line should be exactly ^hl-hl_1 alone
		expect(lines.every((l) => l !== "^hl-hl_1")).toBe(true);
		// The content line (second-to-last before empty + end marker) ends with the block ID
		const contentLine = lines.find((l) => l.endsWith(" ^hl-hl_1"));
		expect(contentLine).toBeDefined();
	});

	test("structure: start, content with inline ID, blank line, end marker", () => {
		const block = parser.generateHighlightBlock(createAnnotation());
		const lines = block.split("\n");
		expect(lines[0]).toBe("%% anotum-hl-start: hl_1 %%");
		expect(lines[lines.length - 1]).toBe("%% anotum-hl-end: hl_1 %%");
		expect(lines.some((l) => l.includes("---"))).toBe(true);
	});

	test("custom single-line template uses exactly the string given", () => {
		const block = parser.generateHighlightBlock(
			createAnnotation(),
			"#{{ color }} {{ highlight }} ^hl-{{ id }}",
		);
		const lines = block.split("\n");
		expect(lines[0]).toBe("%% anotum-hl-start: hl_1 %%");
		expect(lines[2]).toBe("#yellow It's your life. You own it. ^hl-hl_1");
		expect(lines[4]).toBe("%% anotum-hl-end: hl_1 %%");
	});

	test("no ==highlight== syntax in default output", () => {
		const block = parser.generateHighlightBlock(createAnnotation());
		expect(block).not.toContain("==");
	});

	test("no callout syntax in default output", () => {
		const block = parser.generateHighlightBlock(createAnnotation());
		expect(block).not.toContain("[!quote]");
		expect(block).not.toContain("> ");
	});
});

describe("generateBookFile", () => {
	test("single chapter produces one chapter heading", () => {
		const annotations = [
			createAnnotation({ id: "hl_1", index: 0 }),
			createAnnotation({ id: "hl_2", index: 1 }),
		];
		const file = parser.generateBookFile(mockBook, annotations);
		expect((file.match(/%% anotum-chapter: Chapter 1 %%/g) ?? []).length).toBe(
			1,
		);
		expect(file).toContain("## Chapter 1");
	});

	test("two highlights in same chapter are separated by ---", () => {
		const annotations = [
			createAnnotation({ id: "hl_1", index: 0 }),
			createAnnotation({ id: "hl_2", index: 1 }),
		];
		const file = parser.generateBookFile(mockBook, annotations);
		const hl1Start = file.indexOf("%% anotum-hl-start: hl_1 %%");
		const hl1End = file.indexOf("%% anotum-hl-end: hl_1 %%");
		expect(file.slice(hl1Start, hl1End)).toContain("---");
	});

	test("two chapters: --- separates last highlight from next chapter heading", () => {
		const annotations = [
			createAnnotation({ id: "hl_1", index: 0, chapter: "Chapter 1" }),
			createAnnotation({ id: "hl_2", index: 0, chapter: "Chapter 2" }),
		];
		const file = parser.generateBookFile(mockBook, annotations);
		expect(file).toContain("## Chapter 1");
		expect(file).toContain("## Chapter 2");
		const hl1Start = file.indexOf("%% anotum-hl-start: hl_1 %%");
		const hl1End = file.indexOf("%% anotum-hl-end: hl_1 %%");
		expect(file.slice(hl1Start, hl1End)).toContain("---");
	});

	test("chapter heading precedes its highlights", () => {
		const file = parser.generateBookFile(mockBook, [
			createAnnotation({ id: "hl_1", index: 0 }),
		]);
		expect(file.indexOf("## Chapter 1")).toBeLessThan(
			file.indexOf("%% anotum-hl-start: hl_1 %%"),
		);
	});

	test("no chapter produces no heading", () => {
		const file = parser.generateBookFile(mockBook, [
			createAnnotation({ id: "hl_1", chapter: null }),
		]);
		expect(file).not.toContain("anotum-chapter:");
		expect(file).not.toContain("## ");
	});
});

describe("insertHighlightIntoChapter", () => {
	const baseFile = [
		"---",
		'anotum_book_id: "book_1"',
		"---",
		"",
		"%% anotum-chapter: Chapter 1 %%",
		"## Chapter 1",
		"",
		"%% anotum-hl-start: hl_1 %%",
		`**${TEST_DATE_FMT}** — #yellow`,
		"",
		"First highlight ^hl-hl_1",
		"%% anotum-hl-end: hl_1 %%",
		"",
		"---",
		"",
		"%% anotum-chapter: Chapter 2 %%",
		"## Chapter 2",
		"",
		"%% anotum-hl-start: hl_3 %%",
		`**${TEST_DATE_FMT}** — #yellow`,
		"",
		"Chapter 2 highlight ^hl-hl_3",
		"%% anotum-hl-end: hl_3 %%",
	].join("\n");

	test("inserts into existing chapter before next chapter", () => {
		const a = createAnnotation({ id: "hl_2", index: 1, chapter: "Chapter 1" });
		const result = parser.insertHighlightIntoChapter(baseFile, a);
		const hl2Pos = result.indexOf("%% anotum-hl-start: hl_2 %%");
		const ch2Pos = result.indexOf("%% anotum-chapter: Chapter 2 %%");
		expect(hl2Pos).toBeGreaterThan(0);
		expect(hl2Pos).toBeLessThan(ch2Pos);
		expect(
			(result.match(/%% anotum-chapter: Chapter 1 %%/g) ?? []).length,
		).toBe(1);
	});

	test("inserted block gets --- separator from both neighbours", () => {
		const a = createAnnotation({ id: "hl_2", index: 1, chapter: "Chapter 1" });
		const result = parser.insertHighlightIntoChapter(baseFile, a);
		const hl2Start = result.indexOf("%% anotum-hl-start: hl_2 %%");
		const hl2End = result.indexOf("%% anotum-hl-end: hl_2 %%");
		expect(result.slice(hl2Start, hl2End)).toContain("---");
	});

	test("inserts at index 0 before existing first highlight in chapter", () => {
		const a = createAnnotation({ id: "hl_0", index: 0, chapter: "Chapter 1" });
		const result = parser.insertHighlightIntoChapter(baseFile, a);
		expect(result.indexOf("%% anotum-hl-start: hl_0 %%")).toBeLessThan(
			result.indexOf("%% anotum-hl-start: hl_1 %%"),
		);
	});

	test("appends new chapter with heading when chapter is new", () => {
		const a = createAnnotation({ id: "hl_4", index: 0, chapter: "Chapter 3" });
		const result = parser.insertHighlightIntoChapter(baseFile, a);
		expect(result).toContain("%% anotum-chapter: Chapter 3 %%");
		expect(result).toContain("## Chapter 3");
		expect(result.indexOf("## Chapter 3")).toBeGreaterThan(
			result.indexOf("## Chapter 2"),
		);
	});

	test("appends without chapter heading when chapter is null", () => {
		const a = createAnnotation({ id: "hl_5", index: 0, chapter: null });
		const result = parser.insertHighlightIntoChapter(baseFile, a);
		expect(result).toContain("%% anotum-hl-start: hl_5 %%");
		expect((result.match(/%% anotum-chapter:/g) ?? []).length).toBe(2);
	});
});

describe("removeChapterHeadingIfEmpty", () => {
	test("removes heading when only highlight is tombstoned", () => {
		const content = [
			"---",
			'anotum_book_id: "book_1"',
			"---",
			"",
			"%% anotum-chapter: Chapter 1 %%",
			"## Chapter 1",
			"",
			"%% anotum-hl-start: hl_1 %%",
			"[Deleted in Anotum] ^hl-hl_1",
			"",
			"%% anotum-hl-end: hl_1 %%",
		].join("\n");

		const result = parser.removeChapterHeadingIfEmpty(content, "Chapter 1");
		expect(result).not.toContain("%% anotum-chapter: Chapter 1 %%");
		expect(result).not.toContain("## Chapter 1");
	});

	test("keeps heading when a live highlight remains", () => {
		const content = [
			"---",
			'anotum_book_id: "book_1"',
			"---",
			"",
			"%% anotum-chapter: Chapter 1 %%",
			"## Chapter 1",
			"",
			"%% anotum-hl-start: hl_1 %%",
			"[Deleted in Anotum] ^hl-hl_1",
			"",
			"%% anotum-hl-end: hl_1 %%",
			"",
			"---",
			"",
			"%% anotum-hl-start: hl_2 %%",
			`**${TEST_DATE_FMT}** — #yellow`,
			"Still here ^hl-hl_2",
			"",
			"%% anotum-hl-end: hl_2 %%",
		].join("\n");

		const result = parser.removeChapterHeadingIfEmpty(content, "Chapter 1");
		expect(result).toContain("%% anotum-chapter: Chapter 1 %%");
		expect(result).toContain("## Chapter 1");
	});

	test("only removes the matching chapter", () => {
		const content = [
			"---",
			'anotum_book_id: "book_1"',
			"---",
			"",
			"%% anotum-chapter: Chapter 1 %%",
			"## Chapter 1",
			"",
			"%% anotum-hl-start: hl_1 %%",
			"[Deleted in Anotum] ^hl-hl_1",
			"",
			"%% anotum-hl-end: hl_1 %%",
			"",
			"%% anotum-chapter: Chapter 2 %%",
			"## Chapter 2",
			"",
			"%% anotum-hl-start: hl_2 %%",
			`**${TEST_DATE_FMT}** — #yellow`,
			"Still here ^hl-hl_2",
			"",
			"%% anotum-hl-end: hl_2 %%",
		].join("\n");

		const result = parser.removeChapterHeadingIfEmpty(content, "Chapter 1");
		expect(result).not.toContain("## Chapter 1");
		expect(result).toContain("## Chapter 2");
	});
});

describe("updateHighlightBlock", () => {
	test("replaces content, preserves markers and inline block ID", () => {
		const content = [
			"%% anotum-hl-start: hl_1 %%",
			`\n**${TEST_DATE_FMT}** — #yellow\n\nOld text ^hl-hl_1\n`,
			"%% anotum-hl-end: hl_1 %%",
		].join("\n");

		const result = parser.updateHighlightBlock(
			content,
			"hl_1",
			createAnnotation({ highlight: "New text", color: "blue" }),
			"\n#{{ color }} {{ highlight }} ^hl-{{ id }}\n",
		);
		expect(result).toContain("#blue New text ^hl-hl_1");
		expect(result).not.toContain("Old text");
		expect(result).toContain("%% anotum-hl-start: hl_1 %%");
		expect(result).toContain("%% anotum-hl-end: hl_1 %%");
	});
});

describe("tombstoneHighlight", () => {
	test("replaces content with deletion text + inline block ID", () => {
		const content = [
			"%% anotum-hl-start: hl_1 %%",
			`\n**${TEST_DATE_FMT}** — #yellow\n\nSome text ^hl-hl_1\n`,
			"%% anotum-hl-end: hl_1 %%",
		].join("\n");

		const result = parser.tombstoneHighlight(content, "hl_1");
		expect(result).toContain("[Deleted in Anotum] ^hl-hl_1");
		expect(result).not.toContain("Some text");
		expect(result).toContain("%% anotum-hl-start: hl_1 %%");
		expect(result).toContain("%% anotum-hl-end: hl_1 %%");
	});
});

describe("extractHighlightChapter", () => {
	test("returns chapter for a highlight", () => {
		const content = [
			"%% anotum-chapter: Chapter 1 %%",
			"## Chapter 1",
			"",
			"%% anotum-hl-start: hl_1 %%",
			`\n**${TEST_DATE_FMT}** — #yellow\n\nText ^hl-hl_1\n`,
			"%% anotum-hl-end: hl_1 %%",
		].join("\n");
		expect(parser.extractHighlightChapter(content, "hl_1")).toBe("Chapter 1");
	});

	test("returns null when no chapter marker precedes the highlight", () => {
		const content = [
			"%% anotum-hl-start: hl_1 %%",
			`**${TEST_DATE_FMT}** — #yellow`,
			"Text ^hl-hl_1",
			"",
			"%% anotum-hl-end: hl_1 %%",
		].join("\n");
		expect(parser.extractHighlightChapter(content, "hl_1")).toBeNull();
	});
});

describe("removeNoteBlock", () => {
	test("removes note block", () => {
		const content = [
			"%% anotum-hl-end: hl_1 %%",
			"",
			"%% anotum-note-start: hl_1 %%",
			"Some note ^note-hl_1",
			"",
			"%% anotum-note-end: hl_1 %%",
		].join("\n");
		const result = parser.removeNoteBlock(content, "hl_1");
		expect(result).toBe("%% anotum-hl-end: hl_1 %%");
	});
});

describe("extractBookId", () => {
	test("extracts book ID from frontmatter", () => {
		const content = '---\nanotum_book_id: "book_abc"\ntitle: "Book"\n---\n';
		expect(parser.extractBookId(content)).toBe("book_abc");
	});

	test("returns null when no frontmatter", () => {
		expect(parser.extractBookId("Just some text")).toBeNull();
	});
});
