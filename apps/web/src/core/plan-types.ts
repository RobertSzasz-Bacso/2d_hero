/**
 * Plan document types generated from the hero JSON Schema.
 * Do not edit. A test fails if a fresh generate would change this file.
 */

export interface Plan {
  schemaVersion: 2;
  units: "m";
  revision: number;
  project: ProjectInfo;
  levels: Level[];
  sheet: Sheet;
  detection: Detection;
}

export interface Column {
  id: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotationDeg: number;
}

export interface Detection {
  source: DetectionSource | null;
  issues: Issue[];
}

export interface DetectionSource {
  filename: string;
  format: "glb" | "hand";
  unitScaleToMeters: number;
  upAxis: "x" | "y" | "z";
  manhattanAngleDeg: number;
  linked: boolean;
}

export interface Dimension {
  id: string;
  auto: boolean;
  offset: number;
  segments: DimensionSegment[];
}

export interface DimensionSegment {
  a: VertexRef | OpeningRef;
  b: VertexRef | OpeningRef;
}

export interface Fixture {
  id: string;
  symbol: "toilet" | "sink" | "bathtub" | "shower" | "kitchen-counter" | "stove" | "bed-double" | "sofa" | "table" | "wardrobe" | "block" | "chair";
  x: number;
  y: number;
  rotationDeg: number;
  width: number;
  depth: number;
  confidence: number;
  role: "fixture" | "furniture";
}

export interface Issue {
  id: string;
  severity: "info" | "warning" | "error";
  code: "gravity_uncertain" | "units_guessed" | "non_manhattan" | "assumed_thickness" | "open_gap" | "uncertain_room" | "room_seed_lost" | "room_not_split" | "low_confidence_opening" | "missing_source" | "ceiling_missing";
  message: string;
  levelId: string | null;
  elementId: string | null;
}

export interface Level {
  id: string;
  name: string;
  elevation: number;
  ceilingHeight: number;
  vertices: Vertex[];
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  stairs: Stair[];
  rooms: Room[];
  separators: Separator[];
  fixtures: Fixture[];
  texts: PlanText[];
  dimensions: Dimension[];
  suppressedAutoDimensions: string[];
}

export interface Opening {
  id: string;
  wall: string;
  kind: "door" | "window" | "passage";
  offset: number;
  width: number;
  sill: number;
  head: number;
  swing: "left" | "right" | "double" | "sliding" | "none";
  swingSide: "positive" | "negative";
  confidence: number;
}

export interface OpeningRef {
  type: "opening";
  id: string;
  edge: "start" | "end";
}

export interface PlanText {
  id: string;
  x: number;
  y: number;
  text: string;
  heightM: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ProjectInfo {
  name: string;
  address: string;
  northAngleDeg: number;
}

export interface Room {
  id: string;
  name: string;
  number: string;
  seed: Point;
}

export interface Separator {
  id: string;
  a: string;
  b: string;
}

export interface Sheet {
  paper: "A4" | "A3" | "A2" | "A1";
  orientation: "landscape" | "portrait";
  scale: 50 | 100 | 200;
  titleBlock: TitleBlock;
}

export interface Stair {
  id: string;
  outline: Point[];
  direction: Point;
  riserCount: number;
  fromElevation: number;
  toElevation: number;
}

export interface TitleBlock {
  company: string;
  project: string;
  address: string;
  drawnBy: string;
  date: string;
  sheetTitle: string;
  sheetNumber: string;
  revisionNote: string;
}

export interface Vertex {
  id: string;
  x: number;
  y: number;
}

export interface VertexRef {
  type: "vertex";
  id: string;
}

export interface Wall {
  id: string;
  a: string;
  b: string;
  thickness: number;
  kind: "exterior" | "interior" | "partition" | "assumed";
  confidence: number;
}
