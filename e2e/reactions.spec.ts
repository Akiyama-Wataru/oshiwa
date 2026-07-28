import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const groupId = "2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd";
const postId = "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4";
const threadPath = `/groups/${groupId}/posts/${postId}`;
const notificationsPath = "/notifications";

test("未認証の投稿ページをログインへ戻し、その投稿に戻れるようにする", async ({
  page,
}) => {
  const response = await page.goto(threadPath);

  // A notification leads here, so the way back has to be the post itself and
  // not the circle's timeline.
  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(threadPath)}`,
  );
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(threadPath);
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
});

test("未認証のお知らせをログインへ戻し、キャッシュを残さない", async ({
  page,
}) => {
  const response = await page.goto(notificationsPath);

  await expect(page).toHaveURL(
    `/login?returnTo=${encodeURIComponent(notificationsPath)}`,
  );
  await expect(page.locator('input[name="returnTo"]')).toHaveValue(
    notificationsPath,
  );
  expect(response?.headers()["cache-control"]).toMatch(/private/i);
  expect(response?.headers()["cache-control"]).toMatch(/no-store/i);
});

test("投稿ページとお知らせはロボットに拾わせない", async ({ page }) => {
  for (const path of [threadPath, notificationsPath]) {
    await page.goto(path);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/i,
    );
  }
});

test("投稿ページとお知らせのスタイルがCSPに阻まれない", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /content security policy/i.test(message.text())
    ) {
      violations.push(message.text());
    }
  });

  for (const path of [threadPath, notificationsPath]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: "ログイン" }),
    ).toBeVisible();
  }

  expect(violations).toEqual([]);
});

test("お知らせから戻されたログイン画面に深刻なアクセシビリティ違反がない", async ({
  page,
}) => {
  await page.goto(notificationsPath);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
