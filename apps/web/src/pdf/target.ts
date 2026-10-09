import { createContext, type ReactNode } from "react"

/** What a save target gets when the user chose it for a finished PDF. */
export interface PdfSaveRequest {
  bytes: Uint8Array
  filename: string
  /** The 2D Hero project the PDF belongs to. */
  projectId: string
  /** Fall back to the local save. The bytes stay in memory, so there is no second export. */
  download: () => Promise<void>
  close: () => void
}

/** Another place to put a PDF besides the local save. The hosted shell provides one.
 * The editor and `src/pdf/` only know this interface, not Trimble Connect. */
export interface PdfSaveTarget {
  label: string
  render: (request: PdfSaveRequest) => ReactNode
}

export const PdfSaveTargetContext = createContext<PdfSaveTarget | null>(null)
