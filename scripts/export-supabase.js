const fs = require("fs");
const path = require("path");
const axios = require("axios");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY。");
  console.error("請用環境變數執行，例如：");
  console.error('SUPABASE_URL="..." SUPABASE_ANON_KEY="..." node scripts/export-supabase.js');
  process.exit(1);
}

const tables = [
  "schedules",
  "schedule_songs",
  "songs",
  "song_resources",
  "archive_videos",
];

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

async function fetchTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  const response = await axios.get(url, { headers });
  return response.data || [];
}

async function main() {
  const backup = {
    exportedAt: new Date().toISOString(),
    source: "supabase",
    tables: {},
  };

  for (const table of tables) {
    console.log(`匯出 ${table}...`);
    backup.tables[table] = await fetchTable(table);
    console.log(`  ${backup.tables[table].length} 筆`);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const filePath = path.join(
    "backups",
    `supabase-backup-${timestamp}.json`
  );

  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), "utf-8");

  console.log("");
  console.log(`備份完成：${filePath}`);
}

main().catch((error) => {
  console.error("匯出失敗：", error.response?.data || error.message);
  process.exit(1);
});
