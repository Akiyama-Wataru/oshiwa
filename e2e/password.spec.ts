import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("ログイン画面からパスワード再設定へ辿り着ける", async ({ page }) => {
  await page.goto("/login");

  await page.getByRole("link", { name: "パスワードをお忘れの方はこちら" }).click();

  await expect(page).toHaveURL("/password/reset");
  await expect(
    page.getByRole("heading", { level: 1, name: "パスワードの再設定" }),
  ).toBeVisible();
});

test("再設定画面をロボットに拾わせず、キャッシュも残さない", async ({ page }) => {
  const response = await page.goto("/password/reset");

  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );
});

test("リンク切れの案内を再設定画面で読める", async ({ page }) => {
  await page.goto("/password/reset?status=link-expired");

  await expect(page.getByRole("alert")).toContainText("有効期限");
});

test("セッションのない新パスワード画面は再設定へ戻す", async ({ page }) => {
  await page.goto("/password/update");

  await expect(page).toHaveURL("/password/reset?status=link-expired");
});

test("再設定画面に深刻なアクセシビリティ違反がない", async ({ page }) => {
  await page.goto("/password/reset");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
