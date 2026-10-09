import { expect, test, type Page, type Route } from "@playwright/test"

// Phase 22. The parent page (e2e/fixtures/trimble-host.html) stands in for Trimble Connect and
// the Core API is answered by page.route. Only the network is faked: the picker, the files
// module, and the app run for real.
const HOST_ORIGIN = "http://localhost:5191"
const TOKEN = "header-part.payload-part.signature-part"
const SIGNED_URL = "https://files.example-cdn.test/blob/abc?X-Amz-Signature=SECRETSIG&Expires=9"
const CORE = "https://app21.connect.trimble.com/tc/api/2.0"
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
}

interface Seen {
  api: { method: string; path: string; body: string | null }[]
  core: { path: string; authorization: string | null }[]
}

async function mount(page: Page, query = ""): Promise<Seen> {
  const seen: Seen = { api: [], core: [] }
  await page.route("https://*.connect.trimble.com/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS })
      return
    }
    seen.core.push({
      path: url.pathname + url.search,
      authorization: request.headers()["authorization"] ?? null,
    })
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/tc/api/2.0/regions") {
      await reply([
        { location: "northAmerica", origin: "https://app.connect.trimble.com" },
        { location: "europe", origin: "https://app21.connect.trimble.com" },
      ])
    } else if (url.pathname === "/tc/api/2.0/projects/proj-1") {
      await reply({ id: "proj-1", name: "Mock Tower", rootId: "root-1", location: "europe" })
    } else if (url.pathname === "/tc/api/2.0/folders/root-1/items") {
      await reply([
        { id: "folder-scans", type: "FOLDER", name: "Scans" },
        { id: "sheet", versionId: "v0", type: "FILE", name: "Sheet.pdf", size: 1200 },
      ])
    } else if (url.pathname === "/tc/api/2.0/folders/folder-scans/items") {
      await reply([
        { id: "las-1", versionId: "ver-7", type: "FILE", name: "Level 1.las", size: 5_242_880 },
        { id: "dwg-1", versionId: "ver-1", type: "FILE", name: "Plan.dwg", size: 99 },
      ])
    } else if (url.pathname === "/tc/api/2.0/files/fs/las-1/downloadurl") {
      await reply({ url: SIGNED_URL })
    } else {
      await reply({ message: "not mocked" }, 404)
    }
  })
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    seen.api.push({ method: request.method(), path: url.pathname, body: request.postData() })
    if (url.pathname === "/api/health") {
      await route.fulfill({ json: { ok: true } })
    } else if (request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
      await route.fulfill({ status: 401, json: { detail: "Unauthorized" } })
    } else if (url.pathname === "/api/hosted/session") {
      await route.fulfill({ json: { authenticated: true } })
    } else if (url.pathname === "/api/projects/from-url") {
      await route.fulfill({
        json: { id: "p-new", name: "Level 1", revision: 0, importState: "none" },
      })
    } else if (url.pathname.startsWith("/api/transfers/")) {
      await route.fulfill({ json: { state: "running", bytes: 1024, total: 2048 } })
    } else if (url.pathname === "/api/projects/p-new") {
      await route.fulfill({
        json: { id: "p-new", name: "Level 1", revision: 0, importState: "none", importError: "" },
      })
    } else if (url.pathname === "/api/projects/p-new/guess") {
      await route.fulfill({ json: { units: "m", upAxis: "z" } })
    } else if (url.pathname === "/api/projects") {
      await route.fulfill({ json: [] })
    } else if (url.pathname === "/api/settings") {
      await route.fulfill({
        json: { titleBlock: {}, dimensionUnit: "cm", gridSpacingM: 1, cursorKeySet: false },
      })
    } else {
      await route.fulfill({ status: 404, json: { detail: "Not mocked" } })
    }
  })
  await page.goto(`${HOST_ORIGIN}/e2e/fixtures/trimble-host.html?mode=direct${query}`)
  return seen
}

test("the user opens a folder, picks a .las file, and reaches the import screen", async ({ page }) => {
  const seen = await mount(page)
  const frame = page.frameLocator("#ext")

  await expect(frame.getByTestId("trimble-picker")).toBeVisible()
  await expect(frame.getByTestId("trimble-folder")).toHaveText(/Scans/)
  await expect(frame.getByTestId("trimble-file")).toHaveCount(0)
  await expect(frame.getByTestId("trimble-hidden")).toContainText("1")

  await frame.getByTestId("trimble-folder").click()
  await expect(frame.getByTestId("trimble-file")).toHaveCount(1)
  await expect(frame.getByTestId("trimble-file")).toContainText("Level 1.las")
  await expect(frame.getByTestId("trimble-file")).toContainText("5.0 MB")

  await frame.getByTestId("trimble-file").click()

  await expect(frame.getByTestId("guess-units")).toBeVisible()
  await expect(frame.getByTestId("import-start")).toBeVisible()
  expect(page.url()).toContain("trimble-host.html")

  const create = seen.api.find((call) => call.path === "/api/projects/from-url")
  expect(create?.method).toBe("POST")
  const sent = JSON.parse(create?.body ?? "{}") as Record<string, unknown>
  expect(sent.url).toBe(SIGNED_URL)
  expect(sent.fileId).toBe("las-1")
  expect(sent.versionId).toBe("ver-7")
  expect(sent.fileName).toBe("Level 1.las")
  expect(create?.body ?? "").not.toContain(TOKEN)
  expect(seen.api.some((call) => call.path === "/api/dialogs/open-file")).toBe(false)

  expect(seen.core.length).toBeGreaterThan(0)
  for (const call of seen.core.filter((entry) => entry.path.includes("/folders/") || entry.path.includes("/downloadurl"))) {
    expect(call.authorization).toBe(`Bearer ${TOKEN}`)
  }
})

test("the token and the download URL stay out of storage and the address bar", async ({ page }) => {
  await mount(page)
  const frame = page.frameLocator("#ext")
  await frame.getByTestId("trimble-folder").click()
  await frame.getByTestId("trimble-file").click()
  await expect(frame.getByTestId("guess-units")).toBeVisible()

  const handle = await page.locator("#ext").elementHandle()
  const inside = await (await handle!.contentFrame())!.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    cookie: document.cookie,
    href: location.href,
  }))
  for (const value of Object.values(inside)) {
    expect(value).not.toContain(TOKEN)
    expect(value).not.toContain("SECRETSIG")
  }
})

test("models loaded in the viewer are listed and can be opened", async ({ page }) => {
  const seen = await mount(page, "&models=1")
  const frame = page.frameLocator("#ext")

  await expect(frame.getByTestId("trimble-model")).toContainText("Loaded Room.las")
  expect(seen.api.length).toBeGreaterThan(0)
})

test("a folder the user cannot read shows a no-access message", async ({ page }) => {
  await mount(page)
  await page.route("https://*.connect.trimble.com/tc/api/2.0/folders/folder-scans/items", async (route) => {
    await route.fulfill({
      status: 403,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ message: "no" }),
    })
  })
  const frame = page.frameLocator("#ext")

  await frame.getByTestId("trimble-folder").click()

  await expect(frame.getByTestId("trimble-state")).toContainText("access")
})
