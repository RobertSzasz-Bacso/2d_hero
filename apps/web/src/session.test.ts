import { describe, expect, it, vi } from "vitest";
import { takeSessionToken } from "./session.ts";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("takeSessionToken", () => {
  it("reads #t= once and does not put it in localStorage", () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const setLocal = vi.spyOn(localStorage, "setItem");
    const host = {
      location: {
        hash: "#t=session-secret",
        pathname: "/",
        search: "",
      },
      sessionStorage,
      localStorage,
      history: {
        replaceState(_data: unknown, _title: string, url?: string | URL | null) {
          const next = String(url ?? "");
          const hashAt = next.indexOf("#");
          host.location.hash = hashAt >= 0 ? next.slice(hashAt) : "";
          const path = hashAt >= 0 ? next.slice(0, hashAt) : next;
          const queryAt = path.indexOf("?");
          host.location.pathname = queryAt >= 0 ? path.slice(0, queryAt) : path;
          host.location.search = queryAt >= 0 ? path.slice(queryAt) : "";
        },
      },
    };

    expect(takeSessionToken(host)).toBe("session-secret");
    expect(host.location.hash).toBe("");
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).not.toBeNull();
    expect(sessionStorage.getItem(sessionStorage.key(0) as string)).toBe("session-secret");
    expect(localStorage.length).toBe(0);
    expect(setLocal).not.toHaveBeenCalled();

    expect(takeSessionToken(host)).toBe("session-secret");
    expect(setLocal).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
