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

const TABLE_COLUMNS = {
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

function appDataToTables(data) {
  const now = new Date().toISOString();

  const songs = (data.songs || []).map((song) => ({
    id: song.id,
    title: song.title,
    song_key: song.key || song.song_key || "",
    tempo: song.tempo || "",
    note: song.note || "",
    created_at: song.created_at || now,
  }));

  const songResources = (data.songs || []).flatMap((song) =>
    (song.resources || []).map((resource) => ({
      id: resource.id,
      song_id: song.id,
      type: resource.type || "link",
      voice_part: resource.voicePart || resource.voice_part || "全體",
      title: resource.title,
      url: resource.url,
      created_at: resource.created_at || now,
    }))
  );

  const schedules = (data.schedules || []).map((schedule) => ({
    id: schedule.id,
    date: schedule.date,
    title: schedule.title,
    service_type: schedule.serviceType || schedule.service_type || "主日",
    note: schedule.note || "",
    created_at: schedule.created_at || now,
  }));

  const scheduleSongs = (data.schedules || []).flatMap((schedule) =>
    (schedule.songs || []).map((song, index) => ({
      id: `${schedule.id}-${song.id}-${index}`,
      schedule_id: schedule.id,
      song_id: song.id,
      usage_type: song.usageType || song.usage_type || "獻詩",
      sort_order: index,
      created_at: song.created_at || now,
    }))
  );

  const archiveVideos = (data.archiveVideos || data.archive_videos || []).map(
    (video) => ({
      id: video.id,
      title: video.title,
      date: video.date || "",
      event_name: video.eventName || video.event_name || "",
      youtube_url: video.youtubeUrl || video.youtube_url || "",
      description: video.description || "",
      tags: video.tags || "",
      created_at: video.created_at || now,
    })
  );

  return {
    schedules,
    schedule_songs: scheduleSongs,
    songs,
    song_resources: songResources,
    archive_videos: archiveVideos,
  };
}

function tableToValues(tableName, rows) {
  const columns = TABLE_COLUMNS[tableName];

  return [
    columns,
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ];
}

async function writeTable(sheets, tableName, rows) {
  const values = tableToValues(tableName, rows);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${tableName}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tableName}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });
}

async function saveAppDataToSheet(data) {
  const sheets = await getSheetsClient();
  const tables = appDataToTables(data);

  for (const tableName of SHEET_NAMES) {
    await writeTable(sheets, tableName, tables[tableName] || []);
  }

  return refreshCache();
}

function normalizedToAppData(normalized) {
  return {
    schedules: (normalized.schedules || []).map((schedule) => {
      const joined = normalized.schedulesWithSongs.find(
        (item) => item.id === schedule.id
      );

      return {
        id: schedule.id,
        date: schedule.date,
        title: schedule.title,
        serviceType: schedule.service_type || "主日",
        note: schedule.note || "",
        songs: (joined?.songs || []).map((item) => ({
          id: item.song.id,
          title: item.song.title,
          usageType: item.usageType || "獻詩",
        })),
      };
    }),
    songs: (normalized.songs || []).map((song) => ({
      id: song.id,
      title: song.title,
      key: song.song_key || "",
      tempo: song.tempo || "",
      note: song.note || "",
      resources: (normalized.resourcesBySongId.get(song.id) || []).map(
        (resource) => ({
          id: resource.id,
          songId: resource.song_id,
          type: resource.type,
          voicePart: resource.voice_part || "全體",
          title: resource.title,
          url: resource.url,
        })
      ),
    })),
    archiveVideos: (normalized.archiveVideos || []).map((video) => ({
      id: video.id,
      title: video.title,
      date: video.date || "",
      eventName: video.event_name || "",
      youtubeUrl: video.youtube_url || "",
      description: video.description || "",
      tags: video.tags || "",
    })),
  };
}

module.exports = {
  loadAllDataFromSheet,
  getCachedData,
  refreshCache,
  getCacheInfo,
  saveAppDataToSheet,
  normalizedToAppData,
};
