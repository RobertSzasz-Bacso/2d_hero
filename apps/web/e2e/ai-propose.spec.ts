import { expect, test } from "@playwright/test"

test("ask Cursor and see the reply", async ({ page }) => {
  await page.goto("/")
  await page.getByTestId("cursor-message").fill("hello")
  await page.getByTestId("cursor-ask").click()
  await expect(page.getByTestId("cursor-reply")).toContainText("Cursor heard: hello")
})
