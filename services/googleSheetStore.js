const fs = require("fs");
const { google } = require("googleapis");

const DEFAULT_SHEET_ID = "14_073x7K5uy9sbsdKSWKzmpqXJct9l1Bz1JviKOYoaA";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;

const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  ".secrets/google-service-account.json";

const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const SHEET_NAMES = [
  "schedules",
  "schedule_songs",
  "songs",
  "song_resources",
  "archive_videos",
];

let cachedData = null;
let cachedAt = null;

function getServiceAccountCredentials() {
  if (SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(SERVICE_ACCOUNT_JSON);
    } catch (error) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 不是有效的 JSON。");
    }
  }

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(`找不到 Service Account JSON：${SERVICE_ACCOUNT_PATH}`);
  }

  return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
}

async function getSheetsClient() {
  const credentials = getServiceAccountCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();

  return google.sheets({
    version: "v4",
    auth: client,
  });
}

function rowsToObjects(rows) {
  if (!rows || rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);

  return dataRows
    .filter((row) => row.some((cell) => String(cell || "").trim() !== ""))
    .map((row) => {
      const item = {};

      headers.forEach((header, index) => {
        item[header] = row[index] ?? "";
      });

      return item;
    });
}

async function readSheet(sheets, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  return rowsToObjects(response.data.values || []);
}

function normalizeData(rawTables) {
  const schedules = rawTables.schedules || [];
  const scheduleSongs = rawTables.schedule_songs || [];
  const songs = rawTables.songs || [];
  const songResources = rawTables.song_resources || [];
  const archiveVideos = rawTables.archive_videos || [];

  const songsById = new Map(songs.map((song) => [song.id, song]));

  const resourcesBySongId = new Map();

  for (const resource of songResources) {
    if (!resourcesBySongId.has(resource.song_id)) {
      resourcesBySongId.set(resource.song_id, []);
    }

    resourcesBySongId.get(resource.song_id).push(resource);
  }

  const scheduleSongsByScheduleId = new Map();

  for (const item of scheduleSongs) {
    if (!scheduleSongsByScheduleId.has(item.schedule_id)) {
      scheduleSongsByScheduleId.set(item.schedule_id, []);
    }

    scheduleSongsByScheduleId.get(item.schedule_id).push(item);
  }

  for (const list of scheduleSongsByScheduleId.values()) {
    list.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  const schedulesWithSongs = schedules
    .map((schedule) => {
      const items = scheduleSongsByScheduleId.get(schedule.id) || [];

      const joinedSongs = items
        .map((item) => {
          const song = songsById.get(item.song_id);

          if (!song) {
            return null;
          }

          return {
            usageType: item.usage_type || "曲目",
            song,
            resources: resourcesBySongId.get(song.id) || [],
          };
        })
        .filter(Boolean);

      return {
        ...schedule,
        songs: joinedSongs,
      };
    })
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  return {
    schedules,
    scheduleSongs,
    songs,
    songResources,
    archiveVideos,
    schedulesWithSongs,
    songsById,
    resourcesBySongId,
    loadedAt: new Date().toISOString(),
  };
}

async function loadAllDataFromSheet() {
  const sheets = await getSheetsClient();
  const rawTables = {};

  for (const sheetName of SHEET_NAMES) {
    rawTables[sheetName] = await readSheet(sheets, sheetName);
  }

  const normalized = normalizeData(rawTables);

  cachedData = normalized;
  cachedAt = new Date();

  return normalized;
}

async function getCachedData({ forceRefresh = false } = {}) {
  if (!cachedData || forceRefresh) {
    return loadAllDataFromSheet();
  }

  return cachedData;
}

async function refreshCache() {
  return loadAllDataFromSheet();
}

function getCacheInfo() {
  return {
    hasCache: Boolean(cachedData),
    cachedAt: cachedAt ? cachedAt.toISOString() : null,
    sheetId: SHEET_ID,
  };
}

module.exports = {
  loadAllDataFromSheet,
  getCachedData,
  refreshCache,
  getCacheInfo,
};
