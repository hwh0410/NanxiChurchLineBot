# 從 Supabase 遷移至 Google 管理員登入

## 準備 Google Cloud

1. 在 Google Cloud Console 設定「Google Auth Platform」OAuth 同意畫面，建立「網頁應用程式」OAuth Client ID。
2. 把 `https://hwh0410.github.io` 加入「已授權的 JavaScript 來源」。本機開發另加入 `http://localhost:5173`。
3. 若 OAuth 應用程式仍處於「測試中」，需將每位管理員加入 Google OAuth 測試使用者名單；正式發佈則依 Google 政策完成必要設定。
4. Google Cloud 專案需啟用 **Google Sheets API**，後端沿用原先讀取詩班資料的 Google Service Account。

## 管理員 Google Sheet

可直接沿用現有的 `NanxiChurchChoir_Database`，前提是**只有受信任的管理員能編輯整份試算表**，其他團員只能透過網站或 LINE Bot 查詢；若其他團員也能編輯，請使用獨立、受限制的試算表存放授權名單。

在既有試算表中新增工作表，精確命名為 `admin_users`。

第一列欄位必須為：

| email | role | active | google_sub |
| --- | --- | --- | --- |
| admin@example.com | admin | TRUE | |

將範例 email 改為實際管理員自己的 Google 帳號（不要使用範例）。
- `email`：Google 帳號 Email，不區分大小寫。
- `role`：目前只有 `admin` 可以編輯資料。
- `active`：`TRUE` 開啟、`FALSE` 停用。
- `google_sub`：選填。填寫 Google 帳號的穩定唯一 ID，可額外防止 Email 重新指派風險。
- **請不要設定密碼欄位**，也不要在試算表儲存密碼。

沿用原本能讀寫詩班資料的 Google Service Account，不需新增金鑰。若管理員名單與資料庫使用同一份試算表，直接設定 `ADMIN_SHEET_ID` 與現有 `GOOGLE_SHEET_ID` 相同即可。請勿將整份試算表公開分享。

## Render 環境變數

在 Render 服務的 Environment 中新增：

```env
GOOGLE_CLIENT_ID=你的網頁OAuth_Client_ID
ADMIN_SHEET_ID=私人管理員名單Spreadsheet_ID
```

保留已有的：
- `GOOGLE_SERVICE_ACCOUNT_JSON`（或 `GOOGLE_APPLICATION_CREDENTIALS`）
- `GOOGLE_SHEET_ID`（原詩班資料試算表）
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`

不再需要 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`ADMIN_EMAILS` 或 `ADMIN_API_TOKEN`，但請先確定新功能正常，再從 Render 移除。

## 驗證與切換

1. 先部署 Render **測試服務**（指向本 PR 分支 `feature/google-signin-admin-sheet`），使用原資料表的**副本**，避免影響正式資料。測試副本中也要有 `admin_users` 頁籤；測試服務設定 `GOOGLE_SHEET_ID` 與 `ADMIN_SHEET_ID` 為測試副本的相同 ID。
   - Render 新增 Web Service，Build Command 為 `npm ci`，Start Command 為 `npm start`。
   - 測試服務獨立設定 `GOOGLE_SERVICE_ACCOUNT_JSON`、`GOOGLE_CLIENT_ID`、`GOOGLE_SHEET_ID`、`ADMIN_SHEET_ID`。
   - 測試服務**額外設定** `LINE_WEBHOOK_ENABLED=false`，關閉 LINE webhook，因此不需要複製正式 LINE Channel Token / Secret，也不要將 LINE Developers webhook URL 指向測試服務。
   - 請勿把正式 Render 服務的環境變數批次直接複製到測試服務，避免測試服務誤連正式資料庫。
2. `GET /health` 確認後端正常；`GET /api/data` 確認詩班測試資料可讀。
3. `GET /api/admin/me` 未登入需回傳 HTTP 401；未授權 Google 帳號回傳 403；授權帳號應回傳 200。
4. `POST /api/data` 未登入或未授權應拒絕；授權帳號可修改**測試資料**。
5. 將名單中 `active` 改為 `FALSE`，確認下一次修改立刻被拒絕。
6. 切換前端至測試 API 驗證整個流程，再依序部署正式後端、前端。
7. 最後才停用 Supabase 專案；確認沒有其他應用程式依賴它。

每次寫入 API 都會重新從 Google Sheets 取得管理員名單，權限撤銷不依賴快取。Google ID Token 有有效期限，過期後需要重新登入。若試算表或 Google 服務無法驗證，後端會拒絕寫入（fail closed）。

> 重要：GitHub Pages 是靜態網站，`VITE_GOOGLE_CLIENT_ID` 在 **build 階段** 必須注入。部署分支中的程式不應含任何私人憑證。
