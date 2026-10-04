import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"

const obj = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/synthetic/building.obj")

test("open a synthetic OBJ, toggle the underlay, and show the 3D view", async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto("/")
  await page.getByTestId("import-file").setInputFiles(obj)
  await expect(page.getByTestId("guess-units")).toContainText("m")
  await expect(page.getByTestId("guess-up")).toContainText("z")
  await page.getByTestId("import-start").click()
  await expect(page.getByTestId("underlay")).toBeVisible({ timeout: 90_000 })
  await expect(page.getByTestId("level-switcher")).toBeVisible()
  await page.getByTestId("underlay-toggle").click()
  await expect(page.getByTestId("underlay")).toBeHidden()
  await page.getByTestId("toggle-3d").click()
  await expect(page.getByTestId("view-3d")).toBeVisible()
  await expect(page.getByTestId("view-3d").locator("canvas")).toBeVisible()
})
