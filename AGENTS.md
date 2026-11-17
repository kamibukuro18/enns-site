# AGENTS.md — E-nNS 提案用デモサイト

このリポジトリを引き継ぐエージェント（Codex など）向けの説明です。

## 背景
- 埼玉県朝霞市の創作居酒屋「Freestyle Dining E-nNS（フリースタイルダイニング エン）」向けの、**提案用デモサイト**。
- 発注者：GAIBAKO（生貝）。飲食店に「初期費用0円・月3万円・最低12ヶ月」でサイト制作＋予約システム＋更新代行を提供するサブスク事業の第1号案件。
- **店舗の正式な承諾はまだない。** 公開してよいのは「デモ」と分かる状態だけ（画面下部のデモ帯と `noindex` を外さないこと）。

## 構成
```
public/index.html   店舗サイト本体（1ファイル完結。CSS/JSはインライン）
public/admin.html   店舗用の予約管理画面（noindex）
public/404.html
gas/Code.gs         旧方式：Google Apps Script＋スプレッドシートの予約API（参考用）
wrangler.jsonc      Cloudflare Workers（静的アセットのみ）
```
- 予約フォームは `CONFIG.API_URL` が空のとき **デモモード**（ブラウザの localStorage に保存するだけ）。今はこの状態で公開する。
- 写真は Unsplash（商用利用可）からのホットリンク。`index.html` の `IMG` オブジェクトで一元管理。フッターに「掲載写真はイメージです」を表示中。

## 今やってほしいこと（タスク1：公開）
1. GitHub に `enns-site`（Public）リポジトリを作って push する。
2. Cloudflare Workers にデプロイする：
   ```bash
   npm install
   npx wrangler login      # ブラウザでCloudflareにログイン
   npx wrangler deploy     # → https://enns-site.<アカウント>.workers.dev
   ```
   もしくは Cloudflare ダッシュボード → Workers & Pages → Create → Import a repository で、このリポジトリを接続する（ビルドコマンドなし、デプロイコマンドは `npx wrangler deploy`）。
3. 公開URLで、トップのスライド写真・メニュー写真が表示されること、予約フォームがデモとして最後まで進めることを確認する。

## 次のタスク（タスク2：予約システムをCloudflareで本実装）
合意済みの方針：
- **Workers＋静的アセット＋D1** を1つのWorkerにまとめる（Pagesではなく、cronも使うためWorkers）。
- 最初から**マルチテナント**：`shops` テーブルに店舗設定（席数40、滞在2.5時間、曜日別の受付時間、定休日・祝日、20名以上は貸切相談、など。現在の値は `public/index.html` の `CONFIG` と `gas/Code.gs` の `CFG` を参照）。
- テーブル：`shops` / `reservations`（予約経路 source：web・電話・Instagram・LINE・食べログ を記録）/ `blocks`（受付停止・臨時休業）。
- API：`GET /api/calendar?month=`（日別の○△×）、`GET /api/slots?date=`（時間帯ごとの残席）、`POST /api/reserve`（Turnstileで確認）、`/api/admin/*`（Cloudflare Accessで保護）。
- **二重予約防止**：空き確認と挿入は1つのSQL文（`INSERT … SELECT … WHERE 重なる予約の人数合計 + 今回の人数 <= 席数`）で行う。空き計算はサーバー側に一本化し、フロントは表示するだけにする。
- cron：前日17時ごろにリマインドメール、店へは当日の予約一覧。通知は店へLINE Messaging API（LINE Notifyは終了済み）、お客様へはメール（Resendなど）。シークレットは `wrangler secret` で管理。
- 管理画面は「電話予約を10秒で入力できる」ことを最優先にする。予約経路ごとの件数と「グルメサイト手数料の削減額」を表示する。
- 既存のデモUI・デザイン（`public/index.html` の予約セクション、`public/admin.html`）を流用する。

## 守ること
- デモ帯・noindex は、店舗の承諾が出てオーナー（GAIBAKO）が指示するまで外さない。
- 食べログ・Instagram の写真は権利者の許可なく使わない。
- メニュー価格は食べログ掲載（2023年時点）の値。ドリンク価格は未確認のため空欄のまま。
- UIの文言は日本語。
