import nunjucks from "nunjucks";
import escapeStringRegexp from "escape-string-regexp";
import { Document, parse, visit } from "yaml";
import type { Annotation, Book } from "../types";
import { DEFAULT_HIGHLIGHT_TEMPLATE } from "../constants";

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const njkEnv = new nunjucks.Environment(null as never, { autoescape: false });
njkEnv.addFilter("formatDate", (ts: number) => {
	const d = new Date(ts);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
});

export function renderHighlight(
	template: string,
	annotation: Annotation,
): string {
	return njkEnv.renderString(template, {
		id: annotation.id,
		highlight: annotation.highlightEdit ?? annotation.highlight,
		color: annotation.color || "default",
		date: annotation.date,
		note: annotation.note || "",
		chapter: annotation.chapter || "",
		index: annotation.index,
	});
}

export function generateFrontmatter(book: Book): string {
	const doc = new Document({
		anotum_book_id: book.id,
		title: book.title,
		author: book.authors,
		categories: book.categories,
		last_synced: new Date().toISOString(),
	});
	visit(doc, {
		Seq(_, node) {
			node.flow = true;
		},
	});
	return `---\n${doc.toString({ defaultStringType: "QUOTE_DOUBLE" })}---`;
}

export function generateChapterHeading(chapter: string): string {
	return `%% anotum-chapter: ${chapter} %%\n## ${chapter}`;
}

export function generateHighlightBlock(
	annotation: Annotation,
	template = DEFAULT_HIGHLIGHT_TEMPLATE,
): string {
	return [
		`%% anotum-hl-start: ${annotation.id} %%`,
		"",
		renderHighlight(template, annotation),
		"",
		`%% anotum-hl-end: ${annotation.id} %%`,
	].join("\n");
}

export function generateBookFile(
	book: Book,
	annotations: Annotation[],
	template = DEFAULT_HIGHLIGHT_TEMPLATE,
): string {
	const grouped = Map.groupBy(annotations, (a) => a.chapter);
	const body = [...grouped.entries()]
		.flatMap(([chapter, anns]) => [
			...(chapter ? [generateChapterHeading(chapter)] : []),
			...anns.map((a) => generateHighlightBlock(a, template)),
		])
		.join("\n\n");
	return generateFrontmatter(book) + "\n\n" + body;
}

function getBlockBounds(content: string, id: string, type: "hl" | "note") {
	const startMarker = `%% anotum-${type}-start: ${id} %%\n`;
	const endMarker = `\n%% anotum-${type}-end: ${id} %%`;
	const start = content.indexOf(startMarker);
	const end = content.indexOf(endMarker, start);

	if (start === -1 || end === -1) {
		return null;
	}

	return {
		start: start + startMarker.length,
		end: end,
		fullStart: start,
		fullEnd: end + endMarker.length,
	};
}

export function updateHighlightBlock(
	content: string,
	id: string,
	annotation: Annotation,
	template = DEFAULT_HIGHLIGHT_TEMPLATE,
): string {
	const bounds = getBlockBounds(content, id, "hl");

	if (!bounds) {
		return content;
	}

	const newContent = `\n${renderHighlight(template, annotation)}`;
	const existingContent = content.slice(bounds.start, bounds.end);

	if (newContent === existingContent) {
		return content;
	}

	return (
		content.slice(0, bounds.start) + newContent + content.slice(bounds.end)
	);
}

// Splits content into [before-chapter, chapter-section, after-chapter].
function splitAroundChapter(
	content: string,
	chapter: string,
): readonly [string, string, string] {
	const marker = `%% anotum-chapter: ${chapter} %%`;
	const start = content.indexOf(marker);
	const next = content.indexOf("%% anotum-chapter:", start + 1);

	const section =
		next === -1 ? content.slice(start) : content.slice(start, next);
	const post = next === -1 ? "" : content.slice(next);

	return [content.slice(0, start), section, post] as const;
}

function insertIntoSection(
	section: string,
	index: number,
	block: string,
): string {
	const ends = [...section.matchAll(/%% anotum-hl-end: .+? %%/g)];

	if (index > 0 && ends.length > 0) {
		const targetIndex = Math.min(index - 1, ends.length - 1);
		const pivot = ends.at(targetIndex)!;
		const [matchText] = pivot;
		const insertAt = pivot.index! + matchText.length;
		const after = section.slice(insertAt);

		return [
			section.slice(0, insertAt).trimEnd(),
			block,
			after.trimStart(),
		].join("\n\n");
	}

	// Insert as first highlight — before the first hl-start, or at section end if none.
	const firstHlStart = section.indexOf("%% anotum-hl-start:");

	const head =
		firstHlStart === -1
			? section.trimEnd()
			: section.slice(0, firstHlStart).trimEnd();
	const tail = firstHlStart === -1 ? "" : section.slice(firstHlStart);

	if (tail !== "") {
		return [head, block, tail].join("\n\n");
	}

	return `${head}\n\n${block}`;
}

export function insertHighlightIntoChapter(
	content: string,
	annotation: Annotation,
	template = DEFAULT_HIGHLIGHT_TEMPLATE,
): string {
	const hlBlock = generateHighlightBlock(annotation, template);
	const { chapter, index } = annotation;

	if (!chapter) {
		return appendBlock(content, hlBlock);
	}

	if (!content.includes(`%% anotum-chapter: ${chapter} %%`)) {
		return appendBlock(
			content,
			`${generateChapterHeading(chapter)}\n\n${hlBlock}`,
		);
	}

	const [pre, section, post] = splitAroundChapter(content, chapter);
	return pre + insertIntoSection(section, index, hlBlock) + post;
}

export function appendBlock(content: string, block: string): string {
	return content.trimEnd() + "\n\n" + block;
}

export function tombstoneHighlight(content: string, id: string): string {
	const bounds = getBlockBounds(content, id, "hl");

	if (!bounds) {
		return content;
	}

	const tombstone = `\n\n[Deleted in Anotum] ^hl-${id}\n\n`;
	const existingContent = content.slice(bounds.start, bounds.end);

	if (existingContent === tombstone) {
		return content;
	}

	return content.slice(0, bounds.start) + tombstone + content.slice(bounds.end);
}

export function removeNoteBlock(content: string, id: string): string {
	const bounds = getBlockBounds(content, id, "note");

	if (!bounds) {
		return content;
	}

	const before = content.slice(0, bounds.fullStart);
	const stripStart = before.endsWith("\n\n")
		? bounds.fullStart - 2
		: bounds.fullStart;

	return content.slice(0, stripStart) + content.slice(bounds.fullEnd);
}

export function removeChapterHeadingIfEmpty(
	content: string,
	chapter: string,
): string {
	const chapterMarker = `%% anotum-chapter: ${chapter} %%`;
	const start = content.indexOf(chapterMarker);

	if (start === -1) {
		return content;
	}

	const nextChapter = content.indexOf(
		"%% anotum-chapter:",
		start + chapterMarker.length,
	);

	const section =
		nextChapter === -1
			? content.slice(start)
			: content.slice(start, nextChapter);

	const matches = [
		...section.matchAll(
			/%% anotum-hl-start: .+? %%\n([\s\S]*?)\n%% anotum-hl-end:/g,
		),
	];
	const hasLive = matches.some((match) => {
		const [, highlightContent] = match;
		return !highlightContent.trimStart().startsWith("[Deleted in Anotum]");
	});

	if (hasLive) {
		return content;
	}

	const escapedChapter = escapeStringRegexp(chapter);
	const headingRegex = new RegExp(
		`\\n\\n%% anotum-chapter: ${escapedChapter} %%\\n## [^\\n]+`,
	);
	return content.replace(headingRegex, "");
}

export function extractBookId(content: string): string | null {
	const frontmatterStart = content.indexOf("---\n");

	if (frontmatterStart === -1) {
		return null;
	}

	const afterStart = content.slice(frontmatterStart + 4);
	const frontmatterEnd = afterStart.indexOf("\n---");

	if (frontmatterEnd === -1) {
		return null;
	}

	const frontmatterContent = afterStart.slice(0, frontmatterEnd);

	try {
		const parsed = parse(frontmatterContent) as Record<string, unknown>;

		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"anotum_book_id" in parsed
		) {
			const id = parsed.anotum_book_id;
			if (typeof id === "string") {
				return id;
			}
		}

		return null;
	} catch {
		return null;
	}
}

export function extractHighlightIds(content: string): string[] {
	const matches = [...content.matchAll(/%% anotum-hl-start: (.+?) %%/g)];
	return matches.map((match) => {
		const [, id] = match;
		return id;
	});
}

export function hasHighlightBlock(content: string, id: string): boolean {
	return content.includes(`%% anotum-hl-start: ${id} %%`);
}

export function hasNoteBlock(content: string, id: string): boolean {
	return content.includes(`%% anotum-note-start: ${id} %%`);
}

export function updateLastSynced(content: string): string {
	return content.replace(
		/^last_synced:.*$/m,
		`last_synced: "${new Date().toISOString()}"`,
	);
}

export function extractHighlightChapter(
	content: string,
	id: string,
): string | null {
	const hlPos = content.indexOf(`%% anotum-hl-start: ${id} %%`);

	if (hlPos === -1) {
		return null;
	}

	const beforeHighlight = content.slice(0, hlPos);
	const matches = [...beforeHighlight.matchAll(/%% anotum-chapter: (.+?) %%/g)];
	const lastMatch = matches.at(-1);

	if (!lastMatch) {
		return null;
	}

	const [_, chapter] = lastMatch;
	return chapter;
}
