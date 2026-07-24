# 推し輪（OSHIWA）

身内の招待制グループで、推しの写真やコメントを共有するためのPWAです。

フェーズ構成とテストゲートは [`docs/implementation-plan.md`](docs/implementation-plan.md) にまとめています。

## 開発環境

- Node.js `>=22.13.0`
- npm

```bash
cp .env.example .env.local
npm install
npm run dev
```

ローカルでは `http://localhost:3000` を開きます。Supabaseの設定がない開発環境でも、公開入口の確認とテストは実行できます。

## 環境変数

`.env.local` に次の公開クライアント設定を記入します。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

`service_role` キーなどの管理者用秘密情報を `NEXT_PUBLIC_*` に設定しないでください。

## 品質チェック

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run test:rendered
npm run lint
npm run test:e2e
```

すべてを順番に実行する場合:

```bash
npm run test:all
```

## 現在の実装フェーズ

- フェーズ1: 基盤、デザインシステム、PWA入口
- フェーズ2以降: 招待制認証、グループ、推し、投稿、リアクション

本番公開前に、SupabaseのAuth・Postgres・Storage設定とRLSを適用します。
