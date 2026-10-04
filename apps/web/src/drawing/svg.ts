import type { CompiledSheet, DrawCommand } from "./compile.ts"

export function renderSvg(sheet: CompiledSheet): string {
  const model = sheet.commands.filter((command) => command.clipped)
  const frame = sheet.commands.filter((command) => !command.clipped)
  const clipId = "plan"
  const body = [
    ...frame.map((command) => draw(command)),
    `<clipPath id="${clipId}"><rect x="${mm(sheet.clip.x)}" y="${mm(sheet.heightMm - sheet.clip.y - sheet.clip.height)}" width="${mm(sheet.clip.width)}" height="${mm(sheet.clip.height)}"/></clipPath>`,
    `<g clip-path="url(#${clipId})">`,
    ...model.map((command) => draw(command)),
    "</g>",
  ]
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(sheet.widthMm)}mm" height="${mm(sheet.heightMm)}mm" viewBox="0 0 ${mm(sheet.widthMm)} ${mm(sheet.heightMm)}">`,
    ...body,
    "</svg>",
    "",
  ].join("\n")

  function draw(command: DrawCommand): string {
    if (command.op === "fill") {
      const path = command.rings
        .map((ring) => `${move(ring, sheet.heightMm)} Z`)
        .join(" ")
      return `<path d="${path}" fill="#000" fill-opacity="${command.opacity}" fill-rule="evenodd" stroke="none"/>`
    }
    if (command.op === "stroke") {
      const points = command.points
      const extra = command.closed && points[0] ? [...points, points[0]] : points
      const dash = command.dashMm && command.dashMm.length > 0 ? ` stroke-dasharray="${command.dashMm.map(mm).join(" ")}"` : ""
      return `<polyline points="${extra.map((point) => `${mm(point.x)},${mm(sheet.heightMm - point.y)}`).join(" ")}" fill="none" stroke="#000" stroke-width="${mm(command.strokeMm)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`
    }
    const y = sheet.heightMm - command.y
    const anchor = command.anchor === "start" ? "start" : "middle"
    const spin = command.rotationDeg === 0 ? "" : ` transform="rotate(${mm(-command.rotationDeg)} ${mm(command.x)} ${mm(y)})"`
    return `<text x="${mm(command.x)}" y="${mm(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${mm(command.heightMm)}" text-anchor="${anchor}" dominant-baseline="middle" fill="#000" stroke="none"${spin}>${escapeXml(command.text)}</text>`
  }
}

function move(ring: { x: number; y: number }[], height: number): string {
  return ring
    .map((point, index) => `${index === 0 ? "M" : "L"}${mm(point.x)} ${mm(height - point.y)}`)
    .join(" ")
}

function mm(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  if (Object.is(rounded, -0)) {
    return "0"
  }
  return String(rounded)
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
