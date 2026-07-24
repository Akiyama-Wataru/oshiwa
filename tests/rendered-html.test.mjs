import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("推し輪の日本語ランディング画面をサーバーレンダリングする", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang=["']ja["']/i);
  assert.match(html, /<title>推し輪(?:[^<]*)?<\/title>/i);
  assert.match(html, /好きな気持ちを、身内だけで。/);
  assert.match(html, /メールでログイン/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("すべてのHTML応答へセキュリティヘッダーを付与する", async () => {
  const response = await render();

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/,
  );
  assert.match(
    response.headers.get("permissions-policy") ?? "",
    /camera=\(\)/,
  );
});

test("ログインと招待の入口をサーバーレンダリングする", async () => {
  const [loginResponse, joinResponse] = await Promise.all([
    render("/login"),
    render("/join"),
  ]);

  assert.equal(loginResponse.status, 200);
  assert.match(await loginResponse.text(), /ログイン/);
  assert.equal(joinResponse.status, 200);
  assert.match(await joinResponse.text(), /招待に参加/);
});

test("静的PWAファイルにも防御ヘッダーを宣言する", async () => {
  const headers = await readFile(
    new URL("../dist/client/_headers", import.meta.url),
    "utf8",
  );

  assert.match(headers, /X-Content-Type-Options:\s*nosniff/i);
  assert.match(headers, /X-Frame-Options:\s*DENY/i);
  assert.match(headers, /Content-Security-Policy:/i);
  assert.match(headers, /\/sw\.js[\s\S]*Cache-Control:\s*no-cache/i);
  assert.match(
    headers,
    /\/assets\/\*[\s\S]*Cache-Control:\s*public, max-age=31536000, immutable/i,
  );
});

test("スターター固有の画面と依存関係を残さない", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /Starter Project|Geist|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("固定したsharpでPWA画像を安全に変換できる", async () => {
  const [{ default: sharp }, icon] = await Promise.all([
    import("sharp"),
    readFile(new URL("../public/icons/icon-192.png", import.meta.url)),
  ]);
  const { info } = await sharp(icon)
    .resize(32, 32, { fit: "cover" })
    .png()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 32);
  assert.equal(info.height, 32);
  assert.equal(info.format, "png");
});
