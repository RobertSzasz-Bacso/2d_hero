import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const plan = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "two-room.json"), "utf8"))

test("the plan view draws black walls, door swings, and hit-tests the real shapes", async ({ page, request }) => {
  const created = await request.post("/api/projects", {
    multipart: {
      name: "Plan view",
      file: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hand plan") },
    },
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
  const south = page.locator('path[data-wall-id="wSouth"]')
  await expect(south).toBeVisible()
  await expect(page.locator("button[data-wall-id]")).toHaveCount(0)
  expect(await south.evaluate((node) => getComputedStyle(node).fill)).toBe("rgb(0, 0, 0)")
  await expect(page.locator('[data-opening-id="o1"] [data-role="swing"]')).toHaveCount(1)

  const box = await south.boundingBox()
  if (!box) {
    throw new Error("South wall is missing")
  }
  const x = box.x + box.width * 0.25
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await expect(south).toHaveAttribute("data-hover", "true")
  await page.mouse.click(x, y)
  await expect(south).toHaveAttribute("data-selected", "true")
  await expect(page.getByTestId("prop-thickness")).toHaveValue("0.2")
})
