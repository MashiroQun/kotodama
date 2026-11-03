# 言霊チューナー — Cloudflare Pages 公開手順

2026-11-03 時点。正式ブランチは `main`。既存のNetlify配信先は維持して、まずはCloudflare Pagesでも動作を確認します。

## 1. CloudflareのアカウントからGitHubを連携する

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン（アカウントがなければ作成）。
2. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git** を選ぶ。画面で「Import an existing Git repository」と表示される場合はそれを選ぶ。
3. GitHub連携を承認し、`MashiroQun/kotodama` リポジトリへのアクセスを許可する。可能ならこのリポジトリだけを選択する。
4. Cloudflareのプロジェクト名は例として `kotodama-tuner`。既に使用中なら別名を選ぶ。
5. 「Production branch」は `main`。

## 2. ビルド設定

| 項目 | 設定 |
| --- | --- |
| Framework preset | Vite（候補がなければ None） |
| Production branch | `main` |
| Root directory | 未指定（リポジトリ直下を使用） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 20以上（ビルド互換性で問題が出た場合は `NODE_VERSION=22` を設定） |

「Save and Deploy」で最初のデプロイを作成すると、選んだ名前に基づく `*.pages.dev` のURLが割り当てられる。プロジェクト名が空いているかはCloudflare側で決まるため、URLはデプロイ後に確認する。

## 3. 更新機能とキャッシュ

- このViteアプリはビルド時にPWAの`sw.js`を生成し、HTMLに同梱された`pwa-update.js`がそのService Workerを登録する。
- `public/_headers` はViteのビルドで `dist/_headers` にコピーされる。Cloudflare Pagesにより、`/`・`/index.html`・`/sw.js`・`/manifest.webmanifest`に再検証ヘッダー、`/update-recovery.html`に非キャッシュヘッダーが適用される。
- 言霊チューナーのホーム画面アプリは公開元ごとに別のインストールになる。Cloudflareの新しいURLで動作確認してからホーム画面へ追加する。
- Netlifyの試験版とCloudflare本番は別オリジンのため、ブラウザのキャッシュ・マイク許可・ホーム画面登録も別に扱われる。

## 4. 公開後の簡単な動作確認

1. Cloudflareの本番URLをSafariで開き、TUNING START/STOPと3種類の音色を確認する。
2. VOICEを起動してマイク許可を確認し、感度4／8／32／64倍、追従3段階を確認する。
3. ピンチで拡大・縮小し、画面を元の大きさに戻せることを確認する。
4. UPDATEを押し、版の確認画面が表示されることを確認する。
5. `/update-recovery.html` に404なしでアクセスできることを確認する。修復操作は問題発生時だけ実行する。
6. すべて問題なければ「ホーム画面に追加」。Cloudflareを主公開先にする場合は、実機検証後に既存のリンクや独自ドメインを切り替える。

## 参考（Cloudflare公式）

- [Git連携による公開](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [ビルド設定](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [キャッシュ制御ヘッダー](https://developers.cloudflare.com/pages/configuration/headers/)

注意：Cloudflareへのログイン、GitHubアプリの連携承認、最初のプロジェクト作成はCloudflare側で行う必要がある。APIトークンやパスワードをチャットに貼らない。
