import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The screens a signed out visitor can reach. The pages behind a session are
 * covered by the component tests instead: this suite has no way to sign in, and
 * a check that silently ran against a login screen would prove nothing.
 */
const PUBLIC_PATHS = ["/", "/login", "/join", "/password/reset"];

/** The narrowest viewport the plan commits to supporting. */
const NARROW = { width: 320, height: 568 };

/** A phone held sideways: wide enough, but very short. */
const LANDSCAPE = { width: 812, height: 375 };

async function horizontalOverflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const root = document.documentElement;

    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      // Names the element that sticks out, so a failure says what to fix
      // rather than only that something does.
      widest: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((element) => element.getBoundingClientRect().right > root.clientWidth + 1)
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`)
        .slice(0, 5),
    };
  });
}

test.describe("320px", () => {
  test.use({ viewport: NARROW });

  for (const path of PUBLIC_PATHS) {
    test(`${path} が320px幅で横にはみ出さない`, async ({ page }) => {
      await page.goto(path);

      const overflow = await horizontalOverflow(page);

      expect(overflow.widest).toEqual([]);
      // One pixel of slack: sub-pixel rounding is not a layout fault.
      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );
    });
  }

  test("320px幅のログイン画面に深刻なアクセシビリティ違反がない", async ({
    page,
  }) => {
    await page.goto("/login");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});

test.describe("横向き", () => {
  test.use({ viewport: LANDSCAPE });

  for (const path of PUBLIC_PATHS) {
    test(`${path} が横向きでも横にはみ出さない`, async ({ page }) => {
      await page.goto(path);

      const overflow = await horizontalOverflow(page);

      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 1,
      );
    });
  }

  test("横向きでもログインの操作要素すべてに届く", async ({ page }) => {
    await page.goto("/login");

    // A short viewport must scroll rather than cut the form off.
    await expect(page.getByLabel("メールアドレス")).toBeVisible();
    await expect(page.getByLabel("パスワード")).toBeVisible();
    await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();
  });
});

test("キーボードだけでログインの入力から送信まで辿れる", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel("メールアドレス");

  await email.focus();
  await expect(email).toBeFocused();

  // Each stop has to be visible when it is reached, and has to show where the
  // focus is: an outline that the stylesheet removed would leave a keyboard
  // visitor guessing.
  const outline = await email.evaluate((element) => {
    element.focus();
    const style = getComputedStyle(element);
    return { width: style.outlineWidth, style: style.outlineStyle };
  });

  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("パスワード")).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "ログイン" })).toBeFocused();
});

test.describe("動きを減らす設定", () => {
  // Emulated per page rather than through test.use: the project's device
  // preset leaves the context option unapplied, and a preference that never
  // reached the page would make both checks below pass without testing it.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("ボタンに触れても位置が動かない", async ({ page }) => {
    await page.goto("/login");

    const button = page.getByRole("button", { name: "ログイン" });
    const before = await button.boundingBox();

    await button.hover();
    const after = await button.boundingBox();

    // The hover lift is decoration. Someone who asked for less motion asked
    // for this too, not only for the animations.
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 1);
    expect(after?.x).toBeCloseTo(before?.x ?? 0, 1);
  });

  test("入場のアニメーションが動かない", async ({ page }) => {
    await page.goto("/");

    const animated = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(
        (element) => {
          const style = getComputedStyle(element);
          return (
            style.animationName !== "none" &&
            Number.parseFloat(style.animationDuration) > 0.05
          );
        },
      ).length,
    );

    expect(animated).toBe(0);
  });
});
