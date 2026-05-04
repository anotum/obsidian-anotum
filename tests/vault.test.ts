import { describe, test, expect } from "bun:test";
import sanitizeFilename from "sanitize-filename";

function sanitizeFileName(title: string): string {
  const sanitized = sanitizeFilename(title, { replacement: "-" }).trim();
  return sanitized.length > 0 ? sanitized : "Untitled";
}

describe("sanitizeFileName", () => {
  test("returns Untitled for empty string", () => {
    expect(sanitizeFileName("")).toBe("Untitled");
  });

  test("passes through a clean title unchanged", () => {
    expect(sanitizeFileName("The Pragmatic Programmer")).toBe(
      "The Pragmatic Programmer",
    );
  });

  test("sanitizes a real-world title with colon", () => {
    expect(sanitizeFileName("Clean Code: A Handbook")).not.toContain(":");
    expect(sanitizeFileName("Clean Code: A Handbook").length).toBeGreaterThan(0);
  });

  test("sanitizes a real-world title with slash", () => {
    expect(sanitizeFileName("I/O Streams")).not.toContain("/");
    expect(sanitizeFileName("I/O Streams").length).toBeGreaterThan(0);
  });
});
