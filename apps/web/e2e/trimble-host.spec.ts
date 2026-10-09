import { expect, test, type Frame, type Page, type Route } from "@playwright/test"

// The page that stands in for Trimble Connect is e2e/fixtures/trimble-host.html, served by Vite
// on localhost. The app runs in its iframe on 127.0.0.1, so the two are different origins.
const HOST_ORIGIN = "http://localhost:5191"
const APP_URL = "http://127.0.0.1:5191/"
const TOKEN = "header-part.payload-part.signature-part"

type Mode = "direct" | "pending" | "denied" | "silent"

interface ApiCall {
  path: string
  authorization: string | null
  heroToken: string | null
}

function hostUrl(mode: Mode): string {
  return `${HOST_ORIGIN}/e2e/fixtures/trimble-host.html?mode=${mode}`
}

async function mountHost(page: Page, mode: Mode): Promise<ApiCall[]> {
  const calls: ApiCall[] = []
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = request.headers()
    calls.push({
      path: url.pathname,
      authorization: headers["authorization"] ?? null,
      heroToken: headers["x-hero-token"] ?? null,
    })
    if (url.pathname === "/api/health") {
      await route.fulfill({ json: { ok: true } })
      return
    }
    if (headers["authorization"] !== `Bearer ${TOKEN}` || headers["x-hero-token"]) {
      await route.fulfill({ status: 401, json: { detail: "Unauthorized" } })
      return
    }
    if (url.pathname === "/api/hosted/session") {
      await route.fulfill({ json: { authenticated: true } })
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
  await page.goto(hostUrl(mode))
  return calls
}

function appFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().startsWith(APP_URL))
  if (!frame) {
    throw new Error("The extension iframe did not load.")
  }
  return frame
}

for (const mode of ["direct", "pending"] as const) {
  test(`hosted shell connects through the parent API (${mode})`, async ({ page }) => {
    const calls = await mountHost(page, mode)
    const frame = page.frameLocator("#ext")

    await expect(frame.getByTestId("hosted-status")).toContainText("Connected to Trimble Connect")
    await expect(frame.getByTestId("hosted-status")).toContainText("Mock Tower")
    await expect(frame.getByText("Health: ok")).toBeVisible()

    const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log)
    expect(log.filter((entry) => entry.startsWith("requestPermission"))).toEqual([
      "requestPermission:accesstoken",
    ])

    const guarded = calls.filter((call) => call.path !== "/api/health")
    expect(guarded.length).toBeGreaterThan(0)
    for (const call of guarded) {
      expect(call.authorization).toBe(`Bearer ${TOKEN}`)
      expect(call.heroToken).toBeNull()
    }
    expect(calls.some((call) => call.path === "/api/hosted/session")).toBe(true)
  })
}

test("the token stays out of storage, cookies, and the address bar", async ({ page }) => {
  await mountHost(page, "direct")
  await expect(page.frameLocator("#ext").getByTestId("hosted-status")).toContainText("Connected")

  const inside = await appFrame(page).evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    cookie: document.cookie,
    href: location.href,
    html: document.documentElement.outerHTML,
  }))

  for (const value of Object.values(inside)) {
    expect(value).not.toContain(TOKEN)
    expect(value).not.toContain("signature-part")
  }
  expect(inside.local).toBe("{}")
})

test("the shell needs no local session token", async ({ page }) => {
  const calls = await mountHost(page, "direct")
  await expect(page.frameLocator("#ext").getByTestId("hosted-status")).toContainText("Connected")

  const session = await appFrame(page).evaluate(() => sessionStorage.getItem("hero.sessionToken"))
  expect(session).toBeNull()
  expect(calls.every((call) => call.heroToken === null)).toBe(true)
})

test("a denied permission is shown and the editor stays closed", async ({ page }) => {
  const calls = await mountHost(page, "denied")
  const frame = page.frameLocator("#ext")

  await expect(frame.getByRole("alert")).toContainText("denied")
  await expect(frame.getByTestId("hosted-status")).toHaveCount(0)
  expect(calls.filter((call) => call.path !== "/api/health")).toEqual([])
})

test("a parent that never answers shows an unavailable message", async ({ page }) => {
  test.setTimeout(90_000)
  const calls = await mountHost(page, "silent")

  await expect(page.frameLocator("#ext").getByRole("alert")).toContainText("Trimble Connect", {
    timeout: 45_000,
  })
  expect(calls.filter((call) => call.path !== "/api/health")).toEqual([])
})

test("the server rejecting the token is shown, not hidden", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    await route.fulfill({ status: 401, json: { detail: "Unauthorized" } })
  })
  await page.goto(hostUrl("direct"))

  await expect(page.frameLocator("#ext").getByRole("alert")).toContainText("rejected")
})
