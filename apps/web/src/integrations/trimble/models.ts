import { isSupportedName } from "./files.ts";

/** A model the Trimble Connect viewer has loaded. `id` of a viewer model is the file id. */
export interface LoadedModel {
  fileId: string;
  versionId: string;
  name: string;
}

interface ViewerLike {
  viewer?: {
    getModels(state?: "loaded" | "unloaded"): Promise<
      { id: string; versionId: string; name: string }[]
    >;
  };
}

/** The models loaded in the viewer that 2D Hero can import. A failure or no viewer is empty. */
export async function loadedModels(api: ViewerLike): Promise<LoadedModel[]> {
  try {
    const models = (await api.viewer?.getModels("loaded")) ?? [];
    return models
      .filter((model) => model && typeof model.name === "string" && isSupportedName(model.name))
      .map((model) => ({ fileId: model.id, versionId: model.versionId, name: model.name }));
  } catch {
    // The text can echo parent data. Nothing from it is kept.
    return [];
  }
}
