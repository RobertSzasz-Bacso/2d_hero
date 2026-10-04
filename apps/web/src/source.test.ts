import { describe, expect, it } from "vitest";
import { sourceKind } from "./source";

describe("source kind", () => {
  it("marks laser scans as point clouds and leaves meshes alone", () => {
    expect(sourceKind("scan.e57")).toBe("cloud");
    expect(sourceKind("scan.LAS")).toBe("cloud");
    expect(sourceKind("scan.laz")).toBe("cloud");
    expect(sourceKind("scan.ply")).toBe("cloud");
    expect(sourceKind("room.obj")).toBe("mesh");
    expect(sourceKind("room.usdz")).toBe("mesh");
    expect(sourceKind("walls.ifc")).toBe("ifc");
  });
});
