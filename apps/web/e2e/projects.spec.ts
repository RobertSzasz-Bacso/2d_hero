import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const glb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic/building.glb")

test("an unfinished import stays in the list and can be deleted", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(glb)
  await expect(page.getByTestId("guess-units")).toBeVisible()
  await page.reload()
  const unfinished = page.getByTestId("project-row").filter({ hasText: "building" }).filter({ hasText: "Not imported" })
  await expect(unfinished).toHaveCount(1)
  await expect(unfinished.getByTestId("project-status")).toHaveText("Not imported")
  page.once("dialog", (dialog) => {
    void dialog.accept()
  })
  await unfinished.getByTestId("project-delete").click()
  await expect(unfinished).toHaveCount(0)
})

test("an unfinished import can be resumed", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(glb)
  await expect(page.getByTestId("guess-units")).toBeVisible()
  await page.reload()
  const unfinished = page.getByTestId("project-row").filter({ hasText: "building" }).filter({ hasText: "Not imported" })
  await unfinished.getByTestId("project-open").click()
  await expect(page.getByTestId("guess-units")).toBeVisible()
  await page.getByTestId("import-start").click()
  await expect(page.getByTestId("import-overlay")).toBeVisible()
  await expect(page.getByTestId("underlay")).toBeVisible({ timeout: 90_000 })
})
