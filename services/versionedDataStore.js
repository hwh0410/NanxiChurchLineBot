const {
  SHEET_ID, SHEET_NAMES, TABLE_COLUMNS,
  getSheetsClient, rowsToObjects, normalizeData, normalizedToAppData,
  appDataToTables, refreshCache,
} = require("./googleSheetStore");
const { computeDataVersion, buildAtomicUpdateRequests, makeSerializedQueue } =
  require("./versionedWriterCore");

const enqueueWrite = makeSerializedQueue();

async function readLiveSnapshot(sheets) {
  // Bypass Render's memory cache for revision checks.
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: SHEET_NAMES.map((name) => "'" + name + "'!A:Z"),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const originalRows = {};
  const rawTables = {};
  SHEET_NAMES.forEach((name, index) => {
    const rows = response.data.valueRanges?.[index]?.values || [];
    originalRows[name] = rows;
    rawTables[name] = rowsToObjects(rows);
  });
  const normalized = normalizeData(rawTables);
  const data = normalizedToAppData(normalized);
  return {
    data, version: computeDataVersion(data), originalRows,
  };
}

async function getVersionedAppData() {
  const sheets = await getSheetsClient();
  return readLiveSnapshot(sheets);
}

function revisionConflict(currentVersion) {
  const error = new Error("雲端資料已由其他管理員更新，請先重新載入再儲存。");
  error.code = "DATA_CONFLICT";
  error.currentVersion = currentVersion;
  return error;
}

async function saveVersionedAppData(data, { expectedVersion, requireVersion = true } = {}) {
  return enqueueWrite(async () => {
    // Keep legacy and v2 writes in a single process-level queue.
    if (requireVersion && (!expectedVersion || !/^[a-f0-9]{64}$/.test(expectedVersion))) {
      const error = new Error("儲存時必須提供有效的資料版本，請重新載入。");
      error.code = "VERSION_REQUIRED";
      throw error;
    }
    const sheets = await getSheetsClient();
    const live = await readLiveSnapshot(sheets);
    if (requireVersion && expectedVersion !== live.version) {
      throw revisionConflict(live.version);
    }
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
    });
    const requests = buildAtomicUpdateRequests({
      sheetNames: SHEET_NAMES,
      tableColumns: TABLE_COLUMNS,
      tables: appDataToTables(data),
      originalRows: live.originalRows,
      sheetProperties: meta.data.sheets || [],
    });
    // This spreadsheet.batchUpdate call validates the complete batch and
    // applies all five worksheet changes atomically (unlike clear + update).
    // Note: direct edits outside this process are not serialized by this queue.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests, includeSpreadsheetInResponse: false },
    });
    const normalized = await refreshCache();
    const savedData = normalizedToAppData(normalized);
    return {
      data: savedData,
      version: computeDataVersion(savedData),
      cache: { hasCache: true, cachedAt: new Date().toISOString() },
      counts: {
        schedules: normalized.schedules.length,
        scheduleSongs: normalized.scheduleSongs.length,
        songs: normalized.songs.length,
        songResources: normalized.songResources.length,
        archiveVideos: normalized.archiveVideos.length,
      },
    };
  });
}

module.exports = { getVersionedAppData, saveVersionedAppData, readLiveSnapshot };
