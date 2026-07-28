import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const membersPath = `/groups/${groupId}/members`;

test("未認証のメンバー画面をログインへ戻し、キャッシュを残さない", async ({
  page,
}) => {
  const response = await page.goto(membersPath);

  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(membersPath)}`,
  );
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(membersPath);
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
});

test("メンバー画面はロボットに拾わせない", async ({ page }) => {
  await page.goto(membersPath);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );
});

test("メンバー画面のスタイルとスクリプトがCSPに阻まれない", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy/i.test(message.text())
    ) {
      violations.push(message.text());
    }
  });

  await page.goto(membersPath);
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();

  expect(violations).toEqual([]);
});

test("メンバー画面から戻されたログイン画面に深刻なアクセシビリティ違反がない", async ({
  page,
}) => {
  await page.goto(membersPath);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
