# 從 Supabase 遷移至 Google 管理員登入

## 準備 Google Cloud

1. 在 Google Cloud Console 設定「Google Auth Platform」OAuth 同意畫面，建立「網頁應用程式」OAuth Client ID。
2. 把 `https://hwh0410.github.io` 加入「已授權的 JavaScript 來源」。本機開發另加入 `http://localhost:5173`。
3. 若 OAuth 應用程式仍處於「測試中」，需將每位管理員加入 Google OAuth 測試使用者名單；正式發佈則依 Google 政策完成必要設定。
4. Google Cloud 專案需啟用 **Google Sheets API**，後端沿用原先讀取詩班資料的 Google Service Account。

## 建立獨立的私人管理員 Google Sheet

建立一份新的、**不要公開分享**的試算表，例如「NanxiChurchAdmins」。新增工作表，精確命名為 `admin_users`。

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

將此私人試算表分享給 Render 目前使用的 Google Service Account Email，權限為「檢視者」即可。**不要分享給全部詩班團員**。Service Account 仍需另外保有原本詩班資料 Google Sheet 的編輯權。

從試算表網址中取出 `/d/` 後面的 Spreadsheet ID。

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

1. 先部署 Render **測試服務**（指向本 PR 分支），測試服務使用同一個私人管理員名單與原資料表的**副本**，避免影響正式資料。
2. `GET /health` 確認後端正常；`GET /api/data` 確認詩班測試資料可讀。
3. `GET /api/admin/me` 未登入需回傳 HTTP 401；未授權 Google 帳號回傳 403；授權帳號應回傳 200。
4. `POST /api/data` 未登入或未授權應拒絕；授權帳號可修改**測試資料**。
5. 將名單中 `active` 改為 `FALSE`，確認下一次修改立刻被拒絕。
6. 切換前端至測試 API 驗證整個流程，再依序部署正式後端、前端。
7. 最後才停用 Supabase 專案；確認沒有其他應用程式依賴它。

每次寫入 API 都會重新從 Google Sheets 取得管理員名單，權限撤銷不依賴快取。Google ID Token 有有效期限，過期後需要重新登入。若試算表或 Google 服務無法驗證，後端會拒絕寫入（fail closed）。

> 重要：GitHub Pages 是靜態網站，`VITE_GOOGLE_CLIENT_ID` 在 **build 階段** 必須注入。部署分支中的程式不應含任何私人憑證。
