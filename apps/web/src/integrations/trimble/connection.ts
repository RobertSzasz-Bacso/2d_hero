import { connect, type WorkspaceEventCallback } from "trimble-connect-workspace-api";
import { hostBearer } from "../../hostAuth.ts";
import { createHostAdapter, type ConnectFn, type HostAdapter, type WorkspaceLike } from "./adapter.ts";
import {
  allowedParentOrigins,
  isAllowedParentOrigin,
  parentOriginOf,
  shouldBlockMessage,
} from "./origins.ts";

/** True when this page runs inside another page, as a Trimble Connect extension does. */
export function isEmbedded(win: Window = window): boolean {
  try {
    return win.self !== win.top;
  } catch {
    return true;
  }
}

/** The one place that calls the Trimble Workspace API package. */
export function createTrimbleConnect(
  win: Window = window,
  allowed: readonly string[] = allowedParentOrigins(import.meta.env.VITE_TRIMBLE_PARENT_ORIGINS),
): ConnectFn {
  return async (onEvent, timeoutMs) => {
    const parent = win.parent;
    if (parent === win) {
      throw new Error("not embedded");
    }
    const origin = parentOriginOf({
      ancestorOrigins: win.location.ancestorOrigins,
      referrer: win.document.referrer,
    });
    if (!isAllowedParentOrigin(origin, allowed)) {
      throw new Error("parent origin not allowed");
    }
    // The package does not check who sent a message. This listener runs first and drops
    // Workspace API messages that are not from the parent window on an allowed origin.
    win.addEventListener(
      "message",
      (event: MessageEvent) => {
        if (shouldBlockMessage(event, parent, allowed)) {
          event.stopImmediatePropagation();
        }
      },
      true,
    );
    const handler = (event: string, arg: unknown) =>
      onEvent(event, { data: (arg as { data?: unknown } | undefined)?.data });
    const api = await connect(parent, handler as unknown as WorkspaceEventCallback, timeoutMs);
    return api as unknown as WorkspaceLike;
  };
}

export function createTrimbleAdapter(): HostAdapter {
  return createHostAdapter({ connect: createTrimbleConnect(), tokens: hostBearer });
}
