/** The Trimble Connect web app that hosts the extension. Verified in the package's
 * `getConnectEmbedUrl("prod")`. Other regions or environments are added in configuration. */
const DEFAULT_PARENT_ORIGIN = "https://web.connect.trimble.com";

/** The scope the Workspace API puts on every message it sends or answers. */
const DISPATCHER_SCOPE = "Trimble.dispatcher.v1";

function isTestHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".test");
}

function cleanOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" || (url.protocol === "http:" && isTestHost(url.hostname))) {
      return url.origin;
    }
  } catch {
    return null;
  }
  return null;
}

/** Parent origins the shell trusts. `extra` is a comma list from `VITE_TRIMBLE_PARENT_ORIGINS`. */
export function allowedParentOrigins(extra: string | undefined): string[] {
  const list = [DEFAULT_PARENT_ORIGIN];
  for (const part of (extra ?? "").split(",")) {
    const origin = cleanOrigin(part);
    if (origin !== null && !list.includes(origin)) {
      list.push(origin);
    }
  }
  return list;
}

export function isAllowedParentOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin || origin === "null") {
    return false;
  }
  return allowed.includes(origin);
}

/** The origin of the page that embeds us: the browser's ancestor list first, then the referrer. */
export function parentOriginOf(source: {
  ancestorOrigins?: ArrayLike<string>;
  referrer: string;
}): string | undefined {
  const ancestor = source.ancestorOrigins?.[0];
  if (ancestor) {
    const origin = cleanOrigin(ancestor);
    if (origin !== null) {
      return origin;
    }
  }
  if (source.referrer) {
    try {
      return new URL(source.referrer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** True for a Workspace API message that did not come from our parent on an allowed origin.
 * The package does not check the sender, so we stop those messages before it sees them. */
export function shouldBlockMessage(
  event: { source: unknown; origin: string; data: unknown },
  parent: unknown,
  allowed: readonly string[],
): boolean {
  const data = event.data;
  const isDispatcher =
    typeof data === "object" && data !== null && (data as { scope?: unknown }).scope === DISPATCHER_SCOPE;
  if (!isDispatcher) {
    return false;
  }
  return event.source !== parent || !isAllowedParentOrigin(event.origin, allowed);
}
