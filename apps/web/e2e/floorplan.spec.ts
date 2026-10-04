import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");
const gapped = path.join(fixtures, "gapped.obj");

test("upload a gapped scan, connect it, label it, and export a PDF", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(gapped);
  await expect(page.getByTestId("plan-summary")).toContainText("4 walls");
  await expect(page.getByTestId("plan-summary")).toContainText("5 corners");

  const handles = page.locator("[data-testid^=vertex-]");
  const count = await handles.count();
  const points: { id: string; x: number; y: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const handle = handles.nth(index);
    points.push({
      id: (await handle.getAttribute("data-testid")) ?? "",
      x: Number(await handle.getAttribute("data-x")),
      y: Number(await handle.getAttribute("data-y")),
    });
  }
  let best = { left: points[0].id, right: points[1].id, distance: Number.POSITIVE_INFINITY };
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const distance = Math.hypot(points[left].x - points[right].x, points[left].y - points[right].y);
      if (distance < best.distance) best = { left: points[left].id, right: points[right].id, distance };
    }
  }

  await page.getByTestId("tool-connect").click();
  await page.getByTestId(best.left).click();
  await page.getByTestId(best.right).click();
  await expect(page.getByTestId("plan-summary")).toContainText("4 corners");

  await page.getByTestId("tool-annotate").click();
  await page.getByTestId("canvas-surface").click({ position: { x: 220, y: 220 } });
  await page.getByTestId("annotation-text").fill("Kitchen");
  await page.getByTestId("annotation-add").click();
  await expect(page.getByText("Kitchen")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf").click(),
  ]);
  const saved = await download.path();
  expect(saved).toBeTruthy();
  const bytes = readFileSync(saved!);
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  expect(bytes.length).toBeGreaterThan(400);
});

test("doors, measures, and live room area stay on the plan", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path.join(fixtures, "box.obj"));
  const area = page.getByTestId("room-area");
  await expect(area).toBeVisible();
  const before = Number(await area.getAttribute("data-area"));
  expect(before).toBeCloseTo(12, 0);

  const name = page.getByLabel("Room name");
  await name.fill("Kitchen");
  await name.blur();
  await expect(name).toHaveValue("Kitchen");

  await page.getByTestId("tool-door").click();
  await page.locator("[data-testid^=wall-]").first().click();
  const opening = page.locator("[data-testid^=opening-]");
  await expect(opening).toHaveAttribute("data-kind", "door");
  const offset = await opening.getAttribute("data-offset");
  expect(offset).toBeTruthy();

  await page.getByTestId("tool-select").click();
  const handle = page.locator("[data-testid^=vertex-]").first();
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 160, box!.y + 90, { steps: 8 });
  await page.mouse.up();
  await expect(opening).toHaveAttribute("data-offset", offset!);
  await expect.poll(async () => Number(await area.getAttribute("data-area"))).not.toBe(before);

  await page.getByTestId("tool-dimension").click();
  const vertices = page.locator("[data-testid^=vertex-]");
  await vertices.nth(0).click();
  await vertices.nth(1).click();
  await expect(page.locator("[data-testid^=dimension-]")).toContainText("m");
});

test("DXF and SVG export the current plan", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path.join(fixtures, "box.obj"));
  await expect(page.getByTestId("plan-summary")).toContainText("4 walls");

  const [dxf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-dxf").click()]);
  const dxfBytes = readFileSync((await dxf.path())!);
  const dxfText = dxfBytes.toString("utf8");
  expect(dxfText).toContain("WALLS");
  expect(dxfText).toContain("LINE");

  const [svg] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-svg").click()]);
  const svgText = readFileSync((await svg.path())!).toString("utf8");
  expect(svgText).toContain("<svg");
  expect(svgText).toContain('id="walls"');
});

test("the 3D view follows the slice height", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path.join(fixtures, "two_levels.obj"));
  await expect(page.getByTestId("view-3d")).toBeVisible();
  const extents = page.getByTestId("plan-extents");
  await expect.poll(async () => Number(await extents.getAttribute("data-x"))).toBeCloseTo(4, 0);
  await expect.poll(async () => Number(await extents.getAttribute("data-y"))).toBeCloseTo(3, 0);
  await page.getByTestId("slice-height").fill("2.2");
  await expect.poll(async () => Number(await extents.getAttribute("data-x")), { timeout: 8000 }).toBeCloseTo(2, 0);
  await expect.poll(async () => Number(await extents.getAttribute("data-y"))).toBeCloseTo(2, 0);
  await expect(page.getByTestId("view-3d")).toHaveAttribute("data-slice", "2.20");
});

test("learned cleanup keeps a valid plan", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path.join(fixtures, "gapped.obj"));
  await expect(page.getByTestId("plan-summary")).toContainText("walls");
  await page.getByTestId("learned-cleanup").click();
  await expect(page.getByTestId("plan-summary")).toContainText("walls");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a LAS scan is marked as a point cloud", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(path.join(fixtures, "room.las"));
  await expect(page.getByTestId("source-kind")).toHaveText("Point cloud");
  await expect(page.getByTestId("plan-summary")).toContainText("4 walls");
});
