import { describe, test, expect } from "bun:test";
import { getExpiresAt, isExpired } from "../src/auth/jwt";

function createTestJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake_signature`;
}

describe("getExpiresAt", () => {
  test("converts exp claim to milliseconds", () => {
    const jwt = createTestJwt({ exp: 1234567890 });
    expect(getExpiresAt(jwt)).toBe(1234567890000);
  });

  test("throws on invalid token", () => {
    expect(() => getExpiresAt("not-a-jwt")).toThrow();
  });
});

describe("isExpired", () => {
  test("returns true when timestamp is in the past", () => {
    expect(isExpired(Date.now() - 1000)).toBe(true);
  });

  test("returns false when timestamp is in the future", () => {
    expect(isExpired(Date.now() + 60000)).toBe(false);
  });

  test("returns true when timestamp is exactly now", () => {
    const now = Date.now();
    expect(isExpired(now)).toBe(true);
  });
});
