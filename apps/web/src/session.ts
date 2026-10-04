export interface TokenHost {
  location: { hash: string; pathname: string; search: string };
  sessionStorage: Pick<Storage, "getItem" | "setItem">;
  localStorage: Pick<Storage, "setItem">;
  history: {
    replaceState(data: unknown, unused: string, url?: string | URL | null): void;
  };
}

const SESSION_KEY = "hero.sessionToken";

export function takeSessionToken(host: TokenHost = window): string | null {
  const rawHash = host.location.hash.startsWith("#")
    ? host.location.hash.slice(1)
    : host.location.hash;
  const params = new URLSearchParams(rawHash);
  if (params.has("t")) {
    const value = params.get("t");
    if (value) {
      host.sessionStorage.setItem(SESSION_KEY, value);
    }
    params.delete("t");
    const rest = params.toString();
    const next =
      host.location.pathname + host.location.search + (rest.length > 0 ? `#${rest}` : "");
    host.history.replaceState(null, "", next);
  }
  return host.sessionStorage.getItem(SESSION_KEY);
}

export function heroFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = sessionStorage.getItem(SESSION_KEY);
  if (token && !headers.has("X-Hero-Token")) {
    headers.set("X-Hero-Token", token);
  }
  return fetch(input, { ...init, headers });
}
