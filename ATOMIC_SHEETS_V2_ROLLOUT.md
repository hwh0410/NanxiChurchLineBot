# 版本保護／原子寫入：測試、限制與部署順序

## 本分支的安全變更

- `GET /api/data/v2` 每次讀取 Google Sheets 最新資料（不使用 Render 快取），回傳 `data` 及 SHA-256 `version`。
- `POST /api/data/v2` 需要 Google 管理員驗證，請求格式為 `{ "version": "64-character-sha256", "data": { ... } }`。
- 缺少版本回傳 428 `VERSION_REQUIRED`；版本落後回傳 409 `DATA_CONFLICT` 和最新版本，**不觸發寫入**。
- 同一 Node.js 程序中的儲存進入序列佇列；讀取目前 Sheets 最新值後才比對版本。
- 五張資料表寫入透過 **單次** `spreadsheets.batchUpdate` + `updateCells`，保留標題列與格式並清除舊的多餘資料列；不碰 `admin_users`。
- 舊 `POST /api/data` 暫保相容性，但也走原子寫入及序列佇列。若設定 `REQUIRE_VERSIONED_WRITES=true`，舊 POST 改回傳 428，避免無版本的舊網頁覆寫新資料。
- 回傳的版本由資料內容產生，不把個人登入憑證或 Google Sheets 密鑰傳到前端。

## 已自動測試（不連正式試算表）

`node --test tests/*.test.js`

- 版本穩定性、變更偵測、409 衝突與 428 缺少版本。
- 原子更新多個工作表，刪除舊資料時清除多餘列，超過工作表列數時擴充。
- 模擬兩位管理員同時提交同一版本：僅一筆成功，另一筆被拒絕。
- 模擬原子批次失敗：所有表的模擬資料保持原狀。
- 其他既有 Google 管理員驗證測試仍應通過。

## **不應過度承諾的限制**

- 序列佇列存在於單一 Render 程序記憶體中。多個 Render 實例同時寫入、直接編輯 Sheets、或其他使用 API 的程序，仍可能在「檢查版本」與「寫入」之間競爭。若未來需要多實例強保證，應改採有交易／CAS 支援的集中資料庫或租約鎖。
- Google 官方文件確認 `spreadsheets.batchUpdate` 的請求以原子方式套用，但這不代表可以阻止協作者隨後修改。
- 批次 API 失敗與客戶端網路斷線不同：網路斷線有可能在遠端已完成寫入後發生；前端應重新取得版本確認。
- 尚未用專用**測試試算表**及實際 Google Sheets API 做端到端寫入驗收，也尚未實際部署 Render。不能僅因測試通過就宣稱上線安全。

## **必要上線順序（暫不執行）**

1. 備份主 Google Sheets 五張業務資料表及 `admin_users`；備份 GitHub 兩 repo 與 Render 既有環境設定。
2. 建立獨立 staging Google Sheets（複製格式與小量測試資料）、獨立 Render staging 服務，設好服務帳號和管理員測試權限，**不要用正式資料做新增／刪除測試**。
3. 先在 staging 部署本後端分支，驗證 v2 GET、POST、409、原子清除、失敗重試、LINE Bot 查詢（staging 需 `LINE_WEBHOOK_ENABLED=false`）。
4. staging 前端以 `VITE_READ_ONLY_PREVIEW=false` 但 **指向 staging API** 執行 CRUD；不可對正式後端寫入。
5. 完整驗收後先部署後端到正式 Render，保持 `REQUIRE_VERSIONED_WRITES=false` 讓舊前端短暫可用；檢查公開頁與 Google 登入。
6. 再手動發布新前端（PR #4），驗證 v2 API 新增／編輯／刪除、手機行程管理。
7. 確認團員／管理員都已切到新版，將正式 Render `REQUIRE_VERSIONED_WRITES=true`，測試舊 POST 428 與新版 POST 正常。
8. 保留回復分支與 Sheets 備份；若要回滾前端，需暫時復原環境開關，否則舊頁面的儲存會被拒絕。

### 相關
- 前端 PR #4： https://github.com/hwh0410/NanxiChurchChoir/pull/4
- Google Sheets 官方 `spreadsheets.batchUpdate` 說明： https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate

