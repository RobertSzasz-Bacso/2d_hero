import { expect, test, type Page } from "@playwright/test"

test("draw a rectangle, a door, a named room, and a toilet", async ({ page, request }) => {
  const created = await request.post("/api/projects", {
    multipart: {
      name: "Drawn plan",
      file: {
        name: "note.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hand plan"),
      },
    },
  })
  if (!created.ok()) {
    throw new Error(await created.text())
  }
  const project = (await created.json()) as { id: string }
  await page.goto(`/?project=${project.id}`)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(page.getByTestId("plan-stage")).toBeVisible()

  await page.getByTestId("tool-wall").click()
  await clickStage(page, 200, 400)
  await typedWall(page, "5", "0")
  await typedWall(page, "4", "90")
  await typedWall(page, "5", "180")
  await typedWall(page, "4", "270")

  await expect(page.getByTestId("room-area")).toHaveText("18.2 m²")

  await page.getByTestId("tool-door").click()
  await page.locator("[data-wall-id]").first().click()
  await expect(page.locator("[data-opening-id]")).toHaveCount(1)

  await page.getByTestId("tool-room").click()
  await clickStage(page, 300, 320)
  await page.getByTestId("room-name").fill("Kitchen")
  await page.getByTestId("room-name").press("Enter")
  await expect(page.locator("[data-room-id]")).toContainText("Kitchen")
  await expect(page.getByTestId("room-area")).toHaveText("18.2 m²")

  await page.getByTestId("symbol-toilet").click()
  await clickStage(page, 240, 300)
  await expect(page.locator("[data-symbol=toilet]")).toBeVisible()

  await page.getByTestId("tool-column").click()
  await clickStage(page, 160, 280)
  await expect(page.locator("[data-column-id]")).toHaveCount(1)

  await page.getByTestId("tool-stair").click()
  await clickStage(page, 360, 300)
  await expect(page.locator("[data-stair-id]")).toHaveCount(1)

  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect
    .poll(async () => {
      const response = await request.get(`/api/projects/${project.id}/plan`)
      const body = (await response.json()) as {
        levels?: { fixtures?: { symbol: string }[]; columns?: unknown[]; stairs?: unknown[]; rooms?: { name: string }[] }[]
      }
      const level = body.levels?.[0]
      return {
        toilet: level?.fixtures?.some((fixture) => fixture.symbol === "toilet") ?? false,
        column: level?.columns?.length ?? 0,
        stair: level?.stairs?.length ?? 0,
        room: level?.rooms?.[0]?.name ?? "",
      }
    })
    .toEqual({ toilet: true, column: 1, stair: 1, room: "Kitchen" })
  const before = await request.get(`/api/projects/${project.id}/plan`)
  if (!before.ok()) {
    throw new Error(await before.text())
  }
  const saved = await before.json()
  await page.reload()
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(page.locator("[data-symbol=toilet]")).toBeVisible()
  await expect(page.locator("[data-room-id]")).toContainText("Kitchen")
  await expect(page.locator("[data-column-id]")).toHaveCount(1)
  await expect(page.locator("[data-stair-id]")).toHaveCount(1)
  const after = await request.get(`/api/projects/${project.id}/plan`)
  expect(await after.json()).toEqual(saved)
})

async function typedWall(page: Page, length: string, angle: string) {
  await page.getByTestId("wall-length").fill(length)
  await page.getByTestId("wall-angle").fill(angle)
  await page.getByTestId("wall-apply").click()
}

async function clickStage(page: Page, x: number, y: number) {
  const box = await page.getByTestId("plan-stage").boundingBox()
  if (!box) {
    throw new Error("The plan stage is missing")
  }
  await page.mouse.click(box.x + x, box.y + y)
}
