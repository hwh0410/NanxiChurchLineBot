const fs = require("fs");
const path = require("path");

const backupDir = "backups";
const outputDir = "google-sheet-import";

const tableColumns = {
  schedules: [
    "id",
    "date",
    "title",
    "service_type",
    "note",
    "created_at",
  ],
  schedule_songs: [
    "id",
    "schedule_id",
    "song_id",
    "usage_type",
    "sort_order",
    "created_at",
  ],
  songs: [
    "id",
    "title",
    "song_key",
    "tempo",
    "note",
    "created_at",
  ],
  song_resources: [
    "id",
    "song_id",
    "type",
    "voice_part",
    "title",
    "url",
    "created_at",
  ],
  archive_videos: [
    "id",
    "title",
    "date",
    "event_name",
    "youtube_url",
    "description",
    "tags",
    "created_at",
  ],
};

function getLatestBackupFile() {
  const files = fs
    .readdirSync(backupDir)
    .filter((file) => file.startsWith("supabase-backup-") && file.endsWith(".json"))
    .sort();

  if (!files.length) {
    throw new Error("找不到 backups/supabase-backup-*.json");
  }

  return path.join(backupDir, files[files.length - 1]);
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);
  const escaped = text.replace(/"/g, '""');

  if (
    escaped.includes(",") ||
    escaped.includes("\n") ||
    escaped.includes("\r") ||
    escaped.includes('"')
  ) {
    return `"${escaped}"`;
  }

  return escaped;
}

function toCsv(rows, columns) {
  const header = columns.join(",");

  const body = rows.map((row) => {
    return columns.map((column) => escapeCsvValue(row[column])).join(",");
  });

  return [header, ...body].join("\n");
}

function main() {
  const backupFile = getLatestBackupFile();
  const backup = JSON.parse(fs.readFileSync(backupFile, "utf-8"));

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`使用備份檔：${backupFile}`);

  for (const [tableName, columns] of Object.entries(tableColumns)) {
    const rows = backup.tables?.[tableName] || [];
    const csv = toCsv(rows, columns);
    const outputPath = path.join(outputDir, `${tableName}.csv`);

    fs.writeFileSync(outputPath, csv, "utf-8");

    console.log(`${tableName}.csv：${rows.length} 筆`);
  }

  console.log("");
  console.log(`CSV 已輸出到：${outputDir}`);
}

main();
