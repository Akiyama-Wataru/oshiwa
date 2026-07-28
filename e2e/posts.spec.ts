import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const timelinePath = `/groups/${groupId}/posts`;

test("未認証のタイムラインをログインへ戻し、キャッシュを残さない", async ({
  page,
}) => {
  const response = await page.goto(timelinePath);

  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(timelinePath)}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(timelinePath);
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
});

test("絞り込みとページ送りを含むURLも安全な戻り先として保持する", async ({
  page,
}) => {
  const target = `${timelinePath}?oshi=7c308427-3f5d-4cab-a54c-d9b2eecdd4b4&tag=%E5%B0%8A%E3%81%84`;

  await page.goto(target);

  await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(target)}`);
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(target);
});

test("投稿画面はロボットに拾わせない", async ({ page }) => {
  await page.goto(timelinePath);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/i,
  );
});

test("タイムラインのスタイルとスクリプトがCSPに阻まれない", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy/i.test(message.text())
    ) {
      violations.push(message.text());
    }
  });

  await page.goto(timelinePath);
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();

  expect(violations).toEqual([]);
});

test("タイムラインから戻されたログイン画面に深刻なアクセシビリティ違反がない", async ({
  page,
}) => {
  await page.goto(timelinePath);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
