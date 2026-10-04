import {
  clip,
  closePath,
  degrees,
  endPath,
  LineCapStyle,
  LineJoinStyle,
  lineTo,
  moveTo,
  PDFDocument,
  PDFOperator,
  PDFOperatorNames,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  StandardFonts,
  stroke,
} from "pdf-lib"
import type { CompileResult, DrawCommand } from "@/drawing/compile.ts"

const PT = 72 / 25.4

export async function writePdf(result: CompileResult): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const sheet of result.sheets) {
    const page = doc.addPage([sheet.widthMm * PT, sheet.heightMm * PT])
    const frame = sheet.commands.filter((command) => !command.clipped)
    const model = sheet.commands.filter((command) => command.clipped)
    for (const command of frame) {
      paint(page, font, command)
    }
    page.pushOperators(
      pushGraphicsState(),
      rectangle(sheet.clip.x * PT, sheet.clip.y * PT, sheet.clip.width * PT, sheet.clip.height * PT),
      clip(),
      endPath(),
    )
    for (const command of model) {
      paint(page, font, command)
    }
    page.pushOperators(popGraphicsState())
  }
  return doc.save({ useObjectStreams: false })
}

function paint(
  page: ReturnType<PDFDocument["addPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  command: DrawCommand,
): void {
  if (command.op === "fill") {
    const operators = [pushGraphicsState(), setFillingRgbColor(0, 0, 0)]
    for (const ring of command.rings) {
      operators.push(...ringOps(ring, true))
    }
    operators.push(PDFOperator.of(PDFOperatorNames.FillEvenOdd), popGraphicsState())
    page.pushOperators(...operators)
    return
  }
  if (command.op === "stroke") {
    if (command.points.length < 2) {
      return
    }
    const dash = (command.dashMm ?? []).map((value) => value * PT)
    page.pushOperators(
      pushGraphicsState(),
      setLineWidth(command.strokeMm * PT),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
      setDashPattern(dash, 0),
      setStrokingRgbColor(0, 0, 0),
      ...ringOps(command.points, command.closed === true),
      stroke(),
      popGraphicsState(),
    )
    return
  }
  const size = command.heightMm * PT
  const width = font.widthOfTextAtSize(command.text, size)
  const radians = (command.rotationDeg * Math.PI) / 180
  const along = command.anchor === "middle" ? width / 2 : 0
  const baseline = size * 0.35
  const x = command.x * PT - along * Math.cos(radians) + baseline * Math.sin(radians)
  const y = command.y * PT - along * Math.sin(radians) - baseline * Math.cos(radians)
  page.drawText(command.text, {
    x,
    y,
    size,
    font,
    rotate: degrees(command.rotationDeg),
  })
}

function ringOps(points: { x: number; y: number }[], closed: boolean) {
  const operators = []
  points.forEach((point, index) => {
    const x = point.x * PT
    const y = point.y * PT
    operators.push(index === 0 ? moveTo(x, y) : lineTo(x, y))
  })
  if (closed) {
    operators.push(closePath())
  }
  return operators
}
