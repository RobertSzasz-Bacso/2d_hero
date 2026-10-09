import { describe, expect, it } from "vitest";
import {
  allowedParentOrigins,
  isAllowedParentOrigin,
  parentOriginOf,
  shouldBlockMessage,
} from "./origins.ts";

describe("allowedParentOrigins", () => {
  it("defaults to the production Trimble Connect web origin only", () => {
    expect(allowedParentOrigins(undefined)).toEqual(["https://web.connect.trimble.com"]);
  });

  it("adds https origins from configuration and drops everything else", () => {
    const list = allowedParentOrigins(
      "https://web.qa.connect.trimble.com/ , http://insecure.example, *, not a url",
    );

    expect(list).toEqual([
      "https://web.connect.trimble.com",
      "https://web.qa.connect.trimble.com",
    ]);
  });

  it("allows an explicit http origin only for localhost-style test hosts", () => {
    const list = allowedParentOrigins("http://trimble-host.test,http://localhost:5192");

    expect(list).toContain("http://trimble-host.test");
    expect(list).toContain("http://localhost:5192");
  });
});

describe("isAllowedParentOrigin", () => {
  const allowed = ["https://web.connect.trimble.com"];

  it("matches the exact origin", () => {
    expect(isAllowedParentOrigin("https://web.connect.trimble.com", allowed)).toBe(true);
  });

  it.each([
    "https://web.connect.trimble.com.evil.example",
    "https://evil.example",
    "http://web.connect.trimble.com",
    "null",
    "",
    undefined,
  ])("rejects %s", (origin) => {
    expect(isAllowedParentOrigin(origin, allowed)).toBe(false);
  });
});

describe("parentOriginOf", () => {
  it("prefers the browser's ancestor origins", () => {
    expect(
      parentOriginOf({
        ancestorOrigins: ["https://web.connect.trimble.com"],
        referrer: "https://other.example/page",
      }),
    ).toBe("https://web.connect.trimble.com");
  });

  it("falls back to the referrer origin", () => {
    expect(parentOriginOf({ referrer: "https://web.connect.trimble.com/projects/1" })).toBe(
      "https://web.connect.trimble.com",
    );
  });

  it("returns undefined when neither is usable", () => {
    expect(parentOriginOf({ referrer: "" })).toBeUndefined();
    expect(parentOriginOf({ ancestorOrigins: [], referrer: "not a url" })).toBeUndefined();
  });
});

describe("shouldBlockMessage", () => {
  const allowed = ["https://web.connect.trimble.com"];
  const parent = {};
  const stranger = {};
  const trimbleMessage = { scope: "Trimble.dispatcher.v1", type: "event" };

  it("lets the parent's Trimble message through", () => {
    expect(
      shouldBlockMessage(
        { source: parent, origin: "https://web.connect.trimble.com", data: trimbleMessage },
        parent,
        allowed,
      ),
    ).toBe(false);
  });

  it("blocks a Trimble message from another window", () => {
    expect(
      shouldBlockMessage(
        { source: stranger, origin: "https://web.connect.trimble.com", data: trimbleMessage },
        parent,
        allowed,
      ),
    ).toBe(true);
  });

  it("blocks a Trimble message from the parent window on a foreign origin", () => {
    expect(
      shouldBlockMessage(
        { source: parent, origin: "https://evil.example", data: trimbleMessage },
        parent,
        allowed,
      ),
    ).toBe(true);
  });

  it("does not touch messages that are not Trimble dispatcher messages", () => {
    expect(
      shouldBlockMessage(
        { source: stranger, origin: "https://evil.example", data: { type: "webpackOk" } },
        parent,
        allowed,
      ),
    ).toBe(false);
    expect(
      shouldBlockMessage({ source: stranger, origin: "x", data: "text" }, parent, allowed),
    ).toBe(false);
  });
});
