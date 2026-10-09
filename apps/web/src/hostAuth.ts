/** An access token held in memory only. Nothing here touches storage, cookies, or the URL. */
export interface BearerStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export function createBearerStore(): BearerStore {
  let current: string | null = null;
  return {
    get: () => current,
    set(token: string) {
      if (token.length > 0) {
        current = token;
      }
    },
    clear() {
      current = null;
    },
  };
}

/** The hosted (Trimble Connect) bearer token. Empty in local mode. */
export const hostBearer: BearerStore = createBearerStore();
