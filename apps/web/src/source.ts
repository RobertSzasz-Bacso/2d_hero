export type SourceKind = "mesh" | "ifc" | "cloud";

export function sourceKind(filename: string): SourceKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".ifc")) return "ifc";
  if (/\.(e57|las|laz|ply)$/.test(lower)) return "cloud";
  return "mesh";
}
