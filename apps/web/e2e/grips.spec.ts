import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"

const plan = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "two-room.json"), "utf8"))

async function openTwoRooms(page: Page, request: import("@playwright/test").APIRequestContext) {
  const created = await request.post("/api/projects", {
    multipart: { name: "Grips", file: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hand plan") } },
  })
  if (!created.ok()) {
    throw new Error(await created.text())
  }
  const project = (await created.json()) as { id: string }
  const saved = await request.put(`/api/projects/${project.id}/plan`, { data: plan, headers: { "If-Match": "0" } })
  if (!saved.ok()) {
    throw new Error(await saved.text())
  }
  await page.goto(`/?project=${project.id}`)
  await expect(page.locator('path[data-wall-id="wSouth"]')).toBeVisible()
  await page.getByTestId("fit").click()
}

async function clickWall(page: Page, id: string, fraction = 0.25) {
  const box = await page.locator(`path[data-wall-id="${id}"]`).boundingBox()
  if (!box) {
    throw new Error(`Wall ${id} is missing`)
  }
  const horizontal = box.width > box.height
  const x = horizontal ? box.x + box.width * fraction : box.x + box.width / 2
  const y = horizontal ? box.y + box.height / 2 : box.y + box.height * fraction
  await page.mouse.click(x, y)
}

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (!box) {
    throw new Error(`${selector} is missing`)
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test("grips thicken a wall by its face, type a clear width, and flip a door", async ({ page, request }) => {
  await openTwoRooms(page, request)
  const puts: number[] = []
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/plan")) {
      puts.push(Date.now())
    }
  })

  await clickWall(page, "wSouth")
  const south = page.locator('path[data-wall-id="wSouth"]')
  await expect(south).toHaveAttribute("data-selected", "true")
  await expect(page.locator("[data-grip]")).toHaveCount(5)

  const grip = await center(page, '[data-grip="face-right"]')
  await page.mouse.move(grip.x, grip.y)
  const moveStarted = Date.now()
  await page.mouse.down()
  await page.mouse.move(grip.x, grip.y + 12, { steps: 8 })
  const moveEnded = Date.now()
  expect(puts.filter((stamp) => stamp >= moveStarted && stamp <= moveEnded)).toEqual([])
  await page.mouse.up()
  await expect.poll(() => puts.filter((stamp) => stamp > moveEnded).length).toBe(1)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  expect(Number(await south.getAttribute("data-thickness"))).toBeGreaterThan(0.2)

  await clickWall(page, "wEast", 0.2)
  await expect(page.locator('path[data-wall-id="wEast"]')).toHaveAttribute("data-selected", "true")
  await page.getByTestId("temp-dim-clear-left").click()
  await page.getByTestId("temp-dim-input").fill("400")
  await page.getByTestId("temp-dim-input").press("Enter")
  await expect(page.getByTestId("temp-dim-clear-left")).toHaveText("400")
  await expect(page.getByTestId("save-status")).toHaveText("Saved")

  const door = page.locator('[data-opening-id="o1"]')
  const doorCenter = await center(page, '[data-opening-id="o1"] [data-hit]')
  await page.mouse.click(doorCenter.x, doorCenter.y)
  await expect(door).toHaveAttribute("data-selected", "true")
  await expect(door).toHaveAttribute("data-swing-side", "positive")
  await page.getByTestId("flip-side").click()
  await expect(door).toHaveAttribute("data-swing-side", "negative")
})
