import type { Vertex } from "./plan";

export type View = {
  scale: number;
  minX: number;
  maxY: number;
  ox: number;
  oy: number;
};

export function fitView(vertices: Vertex[], width: number, height: number, pad = 56): View {
  if (vertices.length === 0 || width < pad * 2 || height < pad * 2) {
    return { scale: 40, minX: 0, maxY: 1, ox: pad, oy: pad };
  }
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.5);
  const spanY = Math.max(maxY - minY, 0.5);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  return {
    scale,
    minX,
    maxY,
    ox: (width - spanX * scale) / 2,
    oy: (height - spanY * scale) / 2,
  };
}

export function toScreen(x: number, y: number, view: View) {
  return {
    sx: view.ox + (x - view.minX) * view.scale,
    sy: view.oy + (view.maxY - y) * view.scale,
  };
}

export function toPlan(sx: number, sy: number, view: View) {
  return {
    x: view.minX + (sx - view.ox) / view.scale,
    y: view.maxY - (sy - view.oy) / view.scale,
  };
}
