const fs = require("fs");
const { google } = require("googleapis");

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  "14_073x7K5uy9sbsdKSWKzmpqXJct9l1Bz1JviKOYoaA";

const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  ".secrets/google-service-account.json";

const sheetNames = [
  "schedules",
  "schedule_songs",
  "songs",
  "song_resources",
  "archive_videos",
];

async function getSheetsClient() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`找不到 Service Account JSON：${SERVICE_ACCOUNT_PATH}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();

  return google.sheets({
    version: "v4",
    auth: client,
  });
}

async function readSheet(sheets, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = response.data.values || [];
  const header = rows[0] || [];
  const dataRows = rows.slice(1);

  return {
    sheetName,
    columns: header,
    count: dataRows.length,
  };
}

async function main() {
  console.log("開始測試 Google Sheet 讀取...");
  console.log(`Sheet ID: ${SHEET_ID}`);
  console.log(`Service Account: ${SERVICE_ACCOUNT_PATH}`);
  console.log("");

  const sheets = await getSheetsClient();

  for (const sheetName of sheetNames) {
    const result = await readSheet(sheets, sheetName);

    console.log(`工作表：${result.sheetName}`);
    console.log(`欄位：${result.columns.join(", ")}`);
    console.log(`資料筆數：${result.count}`);
    console.log("");
  }

  console.log("Google Sheet 讀取測試成功。");
}

main().catch((error) => {
  console.error("Google Sheet 讀取測試失敗：");
  console.error(error.message);
  process.exit(1);
});
