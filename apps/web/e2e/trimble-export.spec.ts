import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test"

const glb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic/building.glb")

// Phase 23. The parent page (e2e/fixtures/trimble-host.html) stands in for Trimble Connect, and
// page.route answers the Core API and the signed upload host. Only the network is faked: the
// export dialog, the PDF writer, the upload module, and the app run for real.
const HOST_ORIGIN = "http://localhost:5191"
const TOKEN = "header-part.payload-part.signature-part"
const UPLOAD_URL = "https://upload.example-cdn.test/put/1?X-Amz-Signature=SECRETSIG&Expires=9"
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
}

interface Mock {
  /** Names already in the "Drawings" folder. */
  existing: string[]
  uploads: { name: string; head: string; bytes: number; authorization: string | null }[]
  initiated: { parentId: string; parentType: string; name: string }[]
  commits: number
  core: { method: string; path: string; authorization: string | null }[]
  api: { method: string; path: string; body: string | null }[]
  exportRecord: Record<string, string> | null
  failCommitWith: number | null
}

async function newProject(request: APIRequestContext, name: string): Promise<{ id: string; plan: unknown }> {
  const created = await request.post("/api/projects", {
    multipart: { name, file: { name: "building.glb", mimeType: "model/gltf-binary", buffer: readFileSync(glb) } },
  })
  if (!created.ok()) {
    throw new Error(await created.text())
  }
  const { id } = (await created.json()) as { id: string }
  const plan = await (await request.get(`/api/projects/${id}/plan`)).json()
  return { id, plan }
}

async function mount(page: Page, id: string, plan: unknown, options: Partial<Mock> = {}): Promise<Mock> {
  const mock: Mock = {
    existing: [],
    uploads: [],
    initiated: [],
    commits: 0,
    core: [],
    api: [],
    exportRecord: null,
    failCommitWith: null,
    ...options,
  }
  await page.route("https://upload.example-cdn.test/**", async (route: Route) => {
    const request = route.request()
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    const data = request.postDataBuffer() ?? Buffer.alloc(0)
    mock.uploads.push({
      name: "",
      head: data.subarray(0, 5).toString("latin1"),
      bytes: data.length,
      authorization: request.headers()["authorization"] ?? null,
    })
    await route.fulfill({ status: 200, headers: CORS, body: "" })
  })
  await page.route("https://*.connect.trimble.com/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    mock.core.push({
      method: request.method(),
      path: url.pathname + url.search,
      authorization: request.headers()["authorization"] ?? null,
    })
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) })
    const path = url.pathname
    if (path === "/tc/api/2.0/regions") {
      await reply([{ location: "europe", origin: "https://app21.connect.trimble.com" }])
    } else if (path === "/tc/api/2.0/projects/proj-1") {
      await reply({ id: "proj-1", name: "Mock Tower", rootId: "root-1", location: "europe" })
    } else if (path === "/tc/api/2.0/folders/root-1/items") {
      await reply([
        { id: "folder-draw", type: "FOLDER", name: "Drawings" },
        { id: "scan", versionId: "v0", type: "FILE", name: "Level 1.las", size: 12 },
      ])
    } else if (path === "/tc/api/2.0/folders/folder-draw/items") {
      await reply(mock.existing.map((name, index) => ({ id: `old-${index}`, versionId: "v1", type: "FILE", name })))
    } else if (path === "/tc/api/2.0/files/fs/initiate") {
      const body = JSON.parse(request.postData() ?? "{}") as Mock["initiated"][number]
      mock.initiated.push(body)
      await reply({ uploadId: "up-1", uploadURL: UPLOAD_URL })
    } else if (path === "/tc/api/2.0/files/fs/commit") {
      mock.commits += 1
      if (mock.failCommitWith) {
        await reply({ message: "no" }, mock.failCommitWith)
        return
      }
      const last = mock.initiated[mock.initiated.length - 1]
      mock.uploads[mock.uploads.length - 1].name = last?.name ?? ""
      await reply({ id: "new-file", versionId: "ver-1", name: last?.name, type: "FILE" })
    } else {
      await reply({ message: "not mocked" }, 404)
    }
  })
  await page.route("http://127.0.0.1:5191/api/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    mock.api.push({ method: request.method(), path: url.pathname, body: request.postData() })
    if (url.pathname === "/api/health") {
      await route.fulfill({ json: { ok: true } })
    } else if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
      await route.fulfill({ status: 401, json: { detail: "Unauthorized" } })
    } else if (url.pathname === "/api/hosted/session") {
      await route.fulfill({ json: { authenticated: true } })
    } else if (url.pathname === `/api/projects/${id}/plan`) {
      await route.fulfill({ json: plan })
    } else if (url.pathname === `/api/projects/${id}/trimble-export`) {
      mock.exportRecord = JSON.parse(request.postData() ?? "{}") as Record<string, string>
      await route.fulfill({ json: mock.exportRecord })
    } else if (url.pathname === "/api/settings") {
      await route.fulfill({
        json: { titleBlock: {}, dimensionUnit: "cm", gridSpacingM: 1, cursorKeySet: false },
      })
    } else {
      await route.fulfill({ status: 404, json: { detail: "Not mocked" } })
    }
  })
  await page.goto(`${HOST_ORIGIN}/e2e/fixtures/trimble-host.html?mode=direct&app=${encodeURIComponent(`project=${id}`)}`)
  return mock
}

test("in Trimble Connect the PDF is saved to the chosen folder", async ({ page, request }) => {
  const { id, plan } = await newProject(request, "Export plan")
  const mock = await mount(page, id, plan)
  const frame = page.frameLocator("#ext")

  await expect(frame.getByTestId("save-status")).toHaveText("Saved")
  await frame.getByTestId("export-pdf").click()
  await expect(frame.getByTestId("export-download")).toBeVisible()
  await frame.getByTestId("export-target").click()

  await expect(frame.getByTestId("trimble-save-folder")).toHaveText(/Drawings/)
  await frame.getByTestId("trimble-save-folder").click()
  await expect(frame.getByTestId("trimble-save-path")).toContainText("Drawings")
  await frame.getByTestId("trimble-save-here").click()

  await expect(frame.getByTestId("trimble-save-done")).toContainText("Export plan.pdf")
  await expect(frame.getByTestId("trimble-save-done")).toContainText("Drawings")

  expect(mock.initiated).toEqual([{ parentId: "folder-draw", parentType: "FOLDER", name: "Export plan.pdf" }])
  expect(mock.uploads).toHaveLength(1)
  expect(mock.uploads[0].head).toBe("%PDF-")
  expect(mock.uploads[0].bytes).toBeGreaterThan(1000)
  expect(mock.uploads[0].name).toBe("Export plan.pdf")
  expect(mock.uploads[0].authorization).toBeNull()
  for (const call of mock.core.filter((entry) => entry.path.includes("/files/fs/") || entry.path.includes("/folders/"))) {
    expect(call.authorization).toBe(`Bearer ${TOKEN}`)
  }

  // The backend hears where the file landed: ids and a name, never the PDF, a URL, or the token.
  expect(mock.exportRecord).toMatchObject({
    fileId: "new-file",
    versionId: "ver-1",
    folderId: "folder-draw",
    name: "Export plan.pdf",
  })
  const everything = JSON.stringify(mock.api)
  expect(everything).not.toContain("SECRETSIG")
  expect(everything).not.toContain("%PDF")
  expect(mock.api.filter((call) => call.path.endsWith("/trimble-export"))).toHaveLength(1)

  const stored = await (await (await page.locator("#ext").elementHandle())!.contentFrame())!.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
  }))
  expect(stored.local).toContain("folder-draw")
  for (const value of Object.values(stored)) {
    expect(value).not.toContain(TOKEN)
    expect(value).not.toContain("SECRETSIG")
  }
})

test("a name that is taken offers a numbered name, and never overwrites", async ({ page, request }) => {
  const { id, plan } = await newProject(request, "Export plan")
  const mock = await mount(page, id, plan, { existing: ["Export plan.pdf"] })
  const frame = page.frameLocator("#ext")

  await expect(frame.getByTestId("save-status")).toHaveText("Saved")
  await frame.getByTestId("export-pdf").click()
  await frame.getByTestId("export-target").click()
  await frame.getByTestId("trimble-save-folder").click()
  await frame.getByTestId("trimble-save-here").click()

  await expect(frame.getByTestId("trimble-save-conflict")).toContainText("Export plan.pdf")
  expect(mock.initiated).toHaveLength(0)
  expect(mock.uploads).toHaveLength(0)

  await frame.getByTestId("trimble-save-numbered").click()

  await expect(frame.getByTestId("trimble-save-done")).toContainText("Export plan (2).pdf")
  expect(mock.initiated.map((item) => item.name)).toEqual(["Export plan (2).pdf"])
  expect(mock.uploads).toHaveLength(1)
  expect(mock.uploads[0].name).toBe("Export plan (2).pdf")
})

test("the next export starts in the folder used last time", async ({ page, request }) => {
  const { id, plan } = await newProject(request, "Export plan")
  await mount(page, id, plan)
  const frame = page.frameLocator("#ext")
  await expect(frame.getByTestId("save-status")).toHaveText("Saved")
  await frame.getByTestId("export-pdf").click()
  await frame.getByTestId("export-target").click()
  await frame.getByTestId("trimble-save-folder").click()
  await frame.getByTestId("trimble-save-here").click()
  await expect(frame.getByTestId("trimble-save-done")).toBeVisible()
  await frame.getByRole("button", { name: "Close" }).click()

  await frame.getByTestId("export-pdf").click()
  await frame.getByTestId("export-target").click()

  await expect(frame.getByTestId("trimble-save-path")).toContainText("Project files / Drawings")
})

test("a failed upload keeps the PDF so the user can download it", async ({ page, request }) => {
  const { id, plan } = await newProject(request, "Export plan")
  await page.addInitScript(() => {
    const host = window as unknown as { showSaveFilePicker: unknown; savedPdf?: { name: string; head: string } }
    host.showSaveFilePicker = async (options: { suggestedName?: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const head = new TextDecoder().decode(new Uint8Array(await data.slice(0, 5).arrayBuffer()))
          host.savedPdf = { name: options.suggestedName ?? "", head }
        },
        close: async () => undefined,
      }),
    })
  })
  const mock = await mount(page, id, plan, { failCommitWith: 403 })
  const frame = page.frameLocator("#ext")

  await expect(frame.getByTestId("save-status")).toHaveText("Saved")
  await frame.getByTestId("export-pdf").click()
  await frame.getByTestId("export-target").click()
  await frame.getByTestId("trimble-save-folder").click()
  await frame.getByTestId("trimble-save-here").click()

  await expect(frame.getByTestId("trimble-save-error")).toContainText("permission")
  expect(mock.exportRecord).toBeNull()
  await frame.getByTestId("trimble-save-download").click()

  const handle = await page.locator("#ext").elementHandle()
  const inside = (await handle!.contentFrame())!
  await expect
    .poll(() => inside.evaluate(() => (window as unknown as { savedPdf?: { name: string; head: string } }).savedPdf ?? null))
    .toEqual({ name: "Export plan.pdf", head: "%PDF-" })
})

test("in local mode the export dialog only downloads and makes no Trimble request", async ({ page, request }) => {
  const { id } = await newProject(request, "Local plan")
  const trimble: string[] = []
  page.on("request", (entry) => {
    if (new URL(entry.url()).hostname.endsWith("connect.trimble.com")) {
      trimble.push(entry.url())
    }
  })
  await page.addInitScript(() => {
    const host = window as unknown as { showSaveFilePicker: unknown; savedPdf?: { name: string; head: string } }
    host.showSaveFilePicker = async (options: { suggestedName?: string }) => ({
      createWritable: async () => ({
        write: async (data: Blob) => {
          const head = new TextDecoder().decode(new Uint8Array(await data.slice(0, 5).arrayBuffer()))
          host.savedPdf = { name: options.suggestedName ?? "", head }
        },
        close: async () => undefined,
      }),
    })
  })
  await page.goto(`/?project=${id}`)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")

  await page.getByTestId("export-pdf").click()
  await expect(page.getByTestId("export-target")).toHaveCount(0)
  await page.getByTestId("export-download").click()

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { savedPdf?: { name: string; head: string } }).savedPdf ?? null))
    .toEqual({ name: "Local plan.pdf", head: "%PDF-" })
  expect(trimble).toEqual([])
})
