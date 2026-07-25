# 推し輪（OSHIWA）

身内の招待制グループで、推しの写真やコメントを共有するためのPWAです。

フェーズ構成とテストゲートは [`docs/implementation-plan.md`](docs/implementation-plan.md) にまとめています。

## 開発環境

- Node.js `>=22.13.0`（`.nvmrc` に固定。`nvm use` で切り替えます）
- npm

Node.js 20 では `vinext` のビルドが失敗します。作業前に必ずバージョンを確認してください。

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

## Supabaseへの接続

実データで確認するには、Supabaseプロジェクトを1つ用意します。ローカルスタック（`supabase start`）はDockerが必要なので、無料のクラウドプロジェクトを使うのが最短です。

1. Supabaseでプロジェクトを作成します。
2. スキーマを適用します。`supabase/migrations/` の2ファイルを**ファイル名の順に**実行します。

   ```bash
   supabase login && supabase link --project-ref <project-ref> && supabase db push
   ```

   CLIを使わない場合は、SQL Editorに次の順で貼り付けて実行しても同じです。

   - `supabase/migrations/20260724000100_auth_groups.sql`
   - `supabase/migrations/20260725000100_oshis_media.sql`

3. `.env.local` に接続情報を書きます（`.env.example` が雛形です）。`SUPABASE_SECRET_KEY` はサーバー専用で、`NEXT_PUBLIC_*` には絶対に置きません。
4. Authentication → URL Configuration の Redirect URLs に `http://localhost:3000/**` を追加します。招待メールの着地先がここに含まれていないと弾かれます。
5. 最初のオーナーはアプリからは作れません（一般公開登録を提供しないため）。Authentication → Users → Add user で、メールアドレスを確認済みにした利用者を1人だけ作成します。以降のメンバーは、アプリの招待機能から追加します。

無料プランのメール送信には上限があります。招待メールが届かない場合でも、招待作成後に表示される手動リンクを安全な方法で共有すれば参加できます。

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

データベースの不変条件は、使い捨てのPostgreSQLクラスタを立ち上げて検証します。ローカルに`initdb` / `pg_ctl` / `psql`（PostgreSQL 16）が必要です。

```bash
./supabase/tests/run-auth-groups-smoke.sh
```

```bash
./supabase/tests/run-oshis-smoke.sh
```

## 現在の実装フェーズ

- フェーズ1: 基盤、デザインシステム、PWA入口
- フェーズ2: 招待制認証、グループ、権限、RLS
- フェーズ3: 複数の推し、並び替え、メンバーカラー、画像とStorage RLS
- フェーズ4以降: 投稿、タイムライン、リアクション、通知

本番公開前に、SupabaseのAuth・Postgres・Storage設定とRLSを適用します。
