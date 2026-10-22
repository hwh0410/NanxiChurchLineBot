# 楠西教會詩班後台｜Render 隔離測試部署指南

> 狀態：Google Sheets 隔離測試資料庫已建立並填入**虛構資料**，但 Render staging 服務及 Google 服務帳號授權尚未完成。此文件不放任何實際試算表 ID、使用者 Email 或金鑰，避免將私有測試環境暴露於公開 GitHub。

## 已建立的測試試算表結構

| 分頁 | 資料 |
| --- | --- |
| `schedules` | 兩筆日期相同、獨立 ID 的測試聚會 |
| `schedule_songs` | 一筆聚會對應兩首測試曲目，sort_order 0、1 |
| `songs` | 兩首虛構曲目 |
| `song_resources` | 一筆指向 example.com 的虛構練習資源 |
| `archive_videos` | 正確表頭，沒有影片 |
| `admin_users` | 表頭 `email,role,active,google_sub`，沒有任何授權帳號 |

沒有使用或複製任何正式詩班資料，也沒有修改正式試算表。

## Render staging 服務

1. 在 Render 建立**新的** Web Service，不要覆寫原本 `nanxichurchlinebot` 正式服務。
2. 使用 GitHub Repository `hwh0410/NanxiChurchLineBot`，部署分支 `feature/atomic-versioned-sheets-v2`；Root Directory 留空，Build `npm ci`，Start `npm start`。
3. 依 `.env.staging.example` 設定 staging 環境變數。`GOOGLE_SHEET_ID` 指向**新建的隔離測試**試算表，`ADMIN_SHEET_ID` 可指向該測試表中的 `admin_users`。
4. **必須**設定 `STAGING_MODE=true` 和 `LINE_WEBHOOK_ENABLED=false`：程式會在錯誤設定下直接拒絕啟動，且不會向 LINE 發送任何 webhook。
5. 將 Google 服務帳號 Email 以**編輯者**權限分享至該隔離測試試算表，並將服務帳號 JSON 放入 Render **Secret Environment Variables** 的 `GOOGLE_SERVICE_ACCOUNT_JSON`。絕不可把憑證提交至 GitHub。
6. `GOOGLE_CLIENT_ID` 設成既有 Google 網頁用戶端 ID。若要登入測試後台，請先在隔離 Sheet 的 `admin_users` 寫入自己經 Google 驗證的 Email、`role=admin`、`active=true`；正式管理名單不要整份複製進來。
7. `REQUIRE_VERSIONED_WRITES=true`，確保舊版無版本 POST 被拒絕。
8. Render 部署完成後，記下獨立 staging `https://xxxx.onrender.com` 網址。**請勿**用正式服務網址代替。

## 驗證命令

可在 Node 22+ 環境執行：

```bash
STAGING_API_BASE_URL=https://<YOUR_STAGING>.onrender.com node scripts/checkStagingApi.js
```

該腳本只執行 `GET /api/data/v2`，要求回傳 SHA-256 版本與上述虛構 fixture，且拒絕已知正式 Render 網址；**完全不會執行寫入**。

## 實際寫入驗收（需先確認 staging）

- 讀取 v2 `version`，以一個授權帳號新增測試行程，再使用同一個版本第二次送出，應收到 409。
- 檢查五個分頁資料一致，並依序測試加入、編輯、刪除曲目與資源，特別檢查原始 `admin_users` 不受資料寫入操作影響。
- 模擬網路中斷、連續快速儲存、版本落後、重開網頁取得新版。
- 測試後將 fixture 恢復；**不得在正式表格執行清除或錯誤注入**。
- 後端寫入和認證完成驗收後，再建立 pointing at staging Render 的可寫前端測試版本，並指定絕不與正式 GitHub Pages 路徑混用。

## 尚未完成

- 尚未建立／啟動 Render staging 服務。
- 尚未為隔離試算表提供 Google 服務帳號權限。
- 尚未執行經真實 Google OAuth 管理員授權的 staging POST 測試。
- 本 PR 維持 Draft；正式服務不受影響。
