import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const plan = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "two-room.json"), "utf8"))

test("type an instruction, preview the change, accept it, and undo", async ({ page, request }) => {
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
  const south = page.locator('[data-wall-id="wSouth"]')
  await expect(south).toBeVisible()
  await expect(south).toHaveAttribute("data-thickness", "0.2")

  await page.getByTestId("ai-instruction").fill("thickness wSouth 0.35")
  await page.getByTestId("ai-ask").click()
  await expect(page.getByTestId("ai-preview")).toBeVisible()
  await expect(south).toHaveAttribute("data-ai-changed", "true")
  await expect(south).toHaveAttribute("data-thickness", "0.2")

  const beforeAccept = await request.get(`/api/projects/${project.id}/plan`)
  const unsaved = (await beforeAccept.json()) as { levels: { walls: { id: string; thickness: number }[] }[] }
  expect(unsaved.levels[0]?.walls.find((wall) => wall.id === "wSouth")?.thickness).toBe(0.2)

  await page.getByTestId("ai-accept").click()
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(south).toHaveAttribute("data-thickness", "0.35")
  await expect(page.getByTestId("ai-preview")).toHaveCount(0)

  await page.keyboard.press("Control+z")
  await expect(page.getByTestId("save-status")).toHaveText("Saved")
  await expect(south).toHaveAttribute("data-thickness", "0.2")
})
