import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";

test("未認証の推し管理画面をログインへ戻し、キャッシュを残さない", async ({
  page,
}) => {
  const response = await page.goto(`/groups/${groupId}/oshis`);

  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(`/groups/${groupId}/oshis`)}`,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    `/groups/${groupId}/oshis`,
  );
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
});

test("クエリ文字列を含む推しURLも安全な戻り先として保持する", async ({
  page,
}) => {
  const target = `/groups/${groupId}/oshis?sort=name`;

  await page.goto(target);

  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(target)}`,
  );
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(target);
});

test("推し画面のスタイルとスクリプトがCSPに阻まれない", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy/i.test(message.text())
    ) {
      violations.push(message.text());
    }
  });

  await page.goto("/login");
  await expect(
    page.getByRole("heading", { level: 1, name: "ログイン" }),
  ).toBeVisible();

  expect(violations).toEqual([]);
});

test("推し画面から戻されたログイン画面に深刻なアクセシビリティ違反がない", async ({
  page,
}) => {
  await page.goto(`/groups/${groupId}/oshis`);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
