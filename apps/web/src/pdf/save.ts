const LOCKED_PDF = "That PDF is open in another program. Close it, then export again."

type Writable = {
  write: (data: Blob) => Promise<void>
  close: () => Promise<void>
}

type FileHandle = {
  createWritable: () => Promise<Writable>
}

type SavePicker = (options: {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileHandle>

export function describePdfError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return ""
  }
  const name = error instanceof Error ? error.name : ""
  const message = error instanceof Error ? error.message : ""
  const text = `${name} ${message}`
  if (
    name === "NoModificationAllowedError" ||
    /locked|being used by another|access is denied/i.test(text)
  ) {
    return LOCKED_PDF
  }
  return "The PDF was not written. Try again."
}

export async function savePdf(bytes: Uint8Array, filename: string): Promise<void> {
  const picker = savePicker()
  if (!picker) {
    downloadPdf(bytes, filename)
    return
  }
  const handle = await picker({
    suggestedName: filename,
    types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
  })
  const writable = await handle.createWritable()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  await writable.write(new Blob([copy], { type: "application/pdf" }))
  await writable.close()
}

function savePicker(): SavePicker | undefined {
  const host = globalThis as { showSaveFilePicker?: SavePicker }
  return typeof host.showSaveFilePicker === "function" ? host.showSaveFilePicker : undefined
}

function downloadPdf(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const url = URL.createObjectURL(new Blob([copy], { type: "application/pdf" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
