import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("推し輪の入口をモバイルで表示できる", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/推し輪/);
  await expect(
    page.getByRole("heading", { level: 1, name: "推し輪" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "メールでログイン" }),
  ).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("深刻なアクセシビリティ違反がない", async ({ page }) => {
  await page.goto("/");

  const results = await new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21aa",
    "wcag22aa",
  ]).analyze();

  expect(results.violations).toEqual([]);
});

test("キーボードフォーカスが明瞭で画面方向を固定しない", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const focusedLink = page.getByRole("link", { name: "推し輪 ホーム" });
  await expect(focusedLink).toBeFocused();
  const outline = await focusedLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.outlineColor,
      width: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(outline.width).toBeGreaterThanOrEqual(3);
  expect(outline.color).toBe("rgb(23, 18, 23)");

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).orientation).toBeUndefined();
});

test("認証と招待の入口が404にならない", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();

  await page.goto("/join");
  await expect(
    page.getByRole("heading", { level: 1, name: "招待に参加" }),
  ).toBeVisible();
});
