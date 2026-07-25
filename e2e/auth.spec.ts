import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("未認証のグループ画面を安全なログインURLへ戻す", async ({ page }) => {
  await page.goto("/groups/friends?tab=members");

  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fgroups%2Ffriends%3Ftab%3Dmembers$/,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    "/groups/friends?tab=members",
  );
});

test("手動招待をキャッシュせず、可視エラーへトークンを漏らさない", async ({ page }) => {
  const token = "a".repeat(64);

  const response = await page.goto(`/join/${token}`);

  await expect(page).toHaveURL(`/join/${token}`);
  await expect(page.getByRole("alert")).toContainText(
    "招待を確認できませんでした",
  );
  await expect(page.locator("body")).not.toContainText(token);
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
});

test("外部returnToを拒否する", async ({ page }) => {
  await page.goto(
    `/login?returnTo=${encodeURIComponent("https://evil.example/steal")}`,
  );

  await expect(page.locator('input[name="returnTo"]')).toHaveValue("/groups");
});

test("認証画面に深刻なアクセシビリティ違反がない", async ({ page }) => {
  for (const pathname of ["/login", "/join"]) {
    await page.goto(pathname);
    const results = await new AxeBuilder({ page }).withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21aa",
      "wcag22aa",
    ]).analyze();

    expect(results.violations).toEqual([]);
  }
});
