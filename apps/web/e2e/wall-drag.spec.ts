import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const plan = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "two-room.json"), "utf8"))

test("fit, drag a corner, undo, and drag a wall without saving during the move", async ({ page, request }) => {
  const created = await request.post("/api/projects", {
    multipart: {
      name: "Two rooms",
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
  const saved = await request.put(`/api/projects/${project.id}/plan`, {
    data: plan,
    headers: { "If-Match": "0" },
  })
  if (!saved.ok()) {
    throw new Error(await saved.text())
  }

  await page.goto(`/?project=${project.id}`)
  const vertex = page.locator('[data-vertex-id="vSW"]')
  await expect(vertex).toBeVisible()
  await page.getByTestId("fit").click()
  const beforeX = await vertex.getAttribute("data-x")
  const beforeY = await vertex.getAttribute("data-y")

  await dragHandle(page, vertex, 80, 0)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(vertex).not.toHaveAttribute("data-x", beforeX ?? "")

  await page.keyboard.press("Control+z")
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(vertex).toHaveAttribute("data-x", beforeX ?? "")
  await expect(vertex).toHaveAttribute("data-y", beforeY ?? "")

  const east = page.locator('[data-wall-id="wEast"]')
  const lengthBefore = Number(await east.getAttribute("data-length"))
  const puts: number[] = []
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/plan")) {
      puts.push(Date.now())
    }
  })
  const south = page.locator('path[data-wall-id="wSouth"]')
  const box = await south.boundingBox()
  if (!box) {
    throw new Error("South wall is missing")
  }
  const x = box.x + box.width * 0.25
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  const moveStarted = Date.now()
  await page.mouse.down()
  await page.mouse.move(x, y - 160, { steps: 12 })
  const moveEnded = Date.now()
  expect(puts.filter((stamp) => stamp >= moveStarted && stamp <= moveEnded)).toEqual([])
  await page.mouse.up()
  await expect.poll(() => puts.filter((stamp) => stamp > moveEnded).length).toBe(1)
  await expect(page.getByTestId("save-status")).toHaveText("Saved")

  const lengthAfter = Number(await east.getAttribute("data-length"))
  const angleAfter = Number(await east.getAttribute("data-angle"))
  expect(Math.abs(lengthAfter - lengthBefore)).toBeGreaterThan(0.01)
  expect(Math.abs(Math.abs(angleAfter) - 90)).toBeLessThanOrEqual(1)
})

async function dragHandle(
  page: import("@playwright/test").Page,
  handle: import("@playwright/test").Locator,
  dx: number,
  dy: number,
) {
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error("Handle is missing")
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 10 })
  await page.mouse.up()
}
