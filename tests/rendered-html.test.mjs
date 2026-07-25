import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const exactSupabaseOrigin =
  "https://exact-csp-project.supabase.co";
const fakeSupabasePublishableKey = "sb_publishable_render_test";

async function ensureConfiguredRenderedFixture() {
  const serverEntry = new URL("../dist/server/index.js", import.meta.url);
  let builtSource = "";

  try {
    builtSource = await readFile(serverEntry, "utf8");
  } catch {
    // The configured fixture is built below.
  }

  if (
    !builtSource.includes(exactSupabaseOrigin) ||
    !builtSource.includes(fakeSupabasePublishableKey)
  ) {
    await execFileAsync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../node_modules/vinext/dist/cli.js",
            import.meta.url,
          ),
        ),
        "build",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: exactSupabaseOrigin,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            fakeSupabasePublishableKey,
          RENDER_TEST_SUPABASE_ORIGIN: exactSupabaseOrigin,
          WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL = exactSupabaseOrigin;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    fakeSupabasePublishableKey;
  process.env.RENDER_TEST_SUPABASE_ORIGIN = exactSupabaseOrigin;
}

await ensureConfiguredRenderedFixture();

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

test("本番HTMLのnonce CSPとインラインscript nonceを一致させる", async () => {
  // vinext 0.0.50 inlines NEXT_PUBLIC_* during `vinext build`; supplying
  // these values only to the subsequent Node test process is too late.
  assert.equal(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    exactSupabaseOrigin,
    "set the exact fake Supabase URL while building the rendered fixture",
  );
  assert.match(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    /^sb_publishable_/,
    "set a fake publishable key while building the rendered fixture",
  );
  const response = await render();
  const csp = response.headers.get("content-security-policy") ?? "";

  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /\*\.supabase\.co/);
  assert.match(
    csp,
    new RegExp(
      `connect-src[^;]*${exactSupabaseOrigin.replaceAll(".", "\\.")}`,
    ),
  );
  assert.match(
    csp,
    new RegExp(
      `connect-src[^;]*${exactSupabaseOrigin
        .replace(/^https:/, "wss:")
        .replaceAll(".", "\\.")}`,
    ),
  );

  const nonce = csp.match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, "proxy CSP must contain a per-request script nonce");
  for (const headerName of response.headers.keys()) {
    assert.doesNotMatch(headerName, /^x-middleware-/i);
  }

  const html = await response.text();
  const inlineScripts = (html.match(/<script\b[^>]*>/gi) ?? []).filter(
    (tag) => !/\bsrc\s*=/i.test(tag),
  );
  assert.ok(
    inlineScripts.length > 0,
    "rendered App Router HTML must contain inline bootstrap scripts",
  );
  for (const script of inlineScripts) {
    assert.match(
      script,
      new RegExp(`\\bnonce=["']${nonce.replaceAll("-", "\\-")}["']`, "i"),
      `inline script is missing the CSP nonce: ${script}`,
    );
  }

  const nextResponse = await render();
  const nextNonce = (
    nextResponse.headers.get("content-security-policy") ?? ""
  ).match(/script-src[^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nextNonce);
  assert.notEqual(nextNonce, nonce, "each request must receive a fresh nonce");
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
