import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

type Saved = {
  levels: {
    vertices: { id: string; x: number; y: number }[]
    walls: { id: string; a: string; b: string; thickness: number }[]
    rooms: { name: string }[]
    openings: { id: string; wall: string; offset: number; width: number; swingSide: string }[]
    fixtures: { symbol: string }[]
    dimensions: { id: string; auto: boolean; segments: { a: { type: string; id: string }; b: { type: string; id: string } }[] }[]
  }[]
}

async function newProject(request: APIRequestContext, name: string): Promise<string> {
  const created = await request.post("/api/projects", {
    multipart: { name, file: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hand plan") } },
  })
  if (!created.ok()) {
    throw new Error(await created.text())
  }
  return ((await created.json()) as { id: string }).id
}

async function savedPlan(request: APIRequestContext, id: string): Promise<Saved> {
  const response = await request.get(`/api/projects/${id}/plan`)
  if (!response.ok()) {
    throw new Error(await response.text())
  }
  return (await response.json()) as Saved
}

async function stagePoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId("plan-stage").boundingBox()
  if (!box) {
    throw new Error("The plan stage is missing")
  }
  return { x: box.x + x, y: box.y + y }
}

async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (!box) {
    throw new Error(`${selector} is missing`)
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test("draw a room with the rectangle, door, symbol, and dimension tools", async ({ page, request }) => {
  const id = await newProject(request, "Tool plan")
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

  await page.getByTestId("tool-rectangle").click()
  await expect(page.getByTestId("rect-mode")).toHaveValue("interior")
  const corner = await stagePoint(page, 200, 440)
  await page.mouse.click(corner.x, corner.y)
  await page.keyboard.type("480")
  await expect(page.getByTestId("cursor-input-width")).toHaveValue("480")
  await page.keyboard.press("Tab")
  await page.keyboard.type("380")
  await page.keyboard.press("Enter")
  await expect.poll(async () => (await savedPlan(request, id)).levels[0]?.rooms.length ?? 0).toBe(1)

  await page.getByTestId("tool-door").click()
  const south = await page.locator('path[data-wall-id="w1"]').boundingBox()
  if (!south) {
    throw new Error("The south wall is missing")
  }
  await page.mouse.move(south.x + south.width * 0.3, south.y + south.height * 0.3)
  await expect(page.getByTestId("opening-ghost")).toBeVisible()
  await expect(page.getByTestId("ghost-dist-start")).toBeVisible()
  await page.keyboard.type("100")
  await expect(page.getByTestId("cursor-input-distance")).toHaveValue("100")
  await page.keyboard.press("Enter")
  await expect(page.locator("[data-opening-id]")).toHaveCount(1)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect
    .poll(async () => (await savedPlan(request, id)).levels[0]?.openings.length ?? 0)
    .toBe(1)
  const withDoor = await savedPlan(request, id)
  const level = withDoor.levels[0]
  const door = level?.openings[0]
  const wall = level?.walls.find((item) => item.id === door?.wall)
  const a = level?.vertices.find((vertex) => vertex.id === wall?.a)
  const b = level?.vertices.find((vertex) => vertex.id === wall?.b)
  const west = level?.walls.find((item) => item.id !== wall?.id && (item.a === wall?.a || item.b === wall?.a))
  if (!door || !wall || !a || !b || !west) {
    throw new Error("The door or its wall is missing")
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const nearEdge = door.offset * length - door.width / 2
  expect(Math.abs(nearEdge - west.thickness / 2 - 1)).toBeLessThanOrEqual(0.001)

  await page.getByTestId("symbol-sofa").dragTo(page.getByTestId("plan-stage"), { targetPosition: { x: 300, y: 360 } })
  await expect(page.locator("[data-symbol=sofa]")).toHaveCount(1)

  await page.getByTestId("tool-dimension").click()
  const v1 = await centerOf(page, `circle[data-vertex-id="${wall.a}"]`)
  const v2 = await centerOf(page, `circle[data-vertex-id="${wall.b}"]`)
  await page.mouse.click(v1.x, v1.y)
  await page.mouse.click(v2.x, v2.y)
  await expect(page.getByTestId("dimension-preview")).toBeVisible()
  await page.mouse.click(v2.x, v2.y + 50)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect
    .poll(async () => {
      const manual = (await savedPlan(request, id)).levels[0]?.dimensions.filter((item) => !item.auto) ?? []
      return manual.map((item) => item.segments.map((segment) => [segment.a.id, segment.b.id]))
    })
    .toEqual([[[wall.a, wall.b]]])

  const saved = await savedPlan(request, id)
  expect(saved.levels[0]?.fixtures.map((item) => item.symbol)).toEqual(["sofa"])
  await page.reload()
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(page.locator("[data-symbol=sofa]")).toHaveCount(1)
  await expect(page.locator("[data-opening-id]")).toHaveCount(1)
  expect(await savedPlan(request, id)).toEqual(saved)

  await page.getByTestId("export-pdf").click()
  await page.getByTestId("export-download").click()
  await expect.poll(async () => page.evaluate(() => (window as unknown as { savedPdf?: { name: string; head: string } }).savedPdf ?? null)).toEqual({
    name: "Tool plan.pdf",
    head: "%PDF-",
  })
})

test("the wall tool previews, takes typed values at the cursor, and draws the chosen face", async ({ page, request }) => {
  const id = await newProject(request, "Wall tool")
  await page.goto(`/?project=${id}`)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")

  await page.getByTestId("tool-wall").click()
  await page.getByTestId("wall-thickness-25").click()
  await page.getByTestId("wall-location").selectOption("left")
  const start = await stagePoint(page, 200, 400)
  await page.mouse.click(start.x, start.y)
  await page.mouse.move(start.x + 120, start.y + 6)
  await expect(page.getByTestId("wall-preview")).toBeVisible()
  await expect(page.getByTestId("wall-preview-label")).toContainText("°")
  await page.keyboard.down("Shift")
  await page.mouse.move(start.x + 121, start.y + 30)
  await page.keyboard.up("Shift")
  await page.keyboard.type("400")
  await expect(page.getByTestId("cursor-input-length")).toHaveValue("400")
  await page.keyboard.press("Tab")
  await page.getByTestId("cursor-input-angle").fill("0")
  await page.keyboard.press("Enter")
  await expect(page.locator("path[data-wall-id]")).toHaveCount(1)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect.poll(async () => (await savedPlan(request, id)).levels[0]?.walls.length ?? 0).toBe(1)
  const level = (await savedPlan(request, id)).levels[0]
  const wall = level?.walls[0]
  const a = level?.vertices.find((vertex) => vertex.id === wall?.a)
  const b = level?.vertices.find((vertex) => vertex.id === wall?.b)
  if (!wall || !a || !b) {
    throw new Error("The wall is missing")
  }
  expect(wall.thickness).toBe(0.25)
  expect(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 4)).toBeLessThanOrEqual(0.001)
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1e-9)
})
