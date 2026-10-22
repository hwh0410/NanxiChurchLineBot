const {
  SHEET_ID, SHEET_NAMES, TABLE_COLUMNS,
  getSheetsClient, rowsToObjects, normalizeData, normalizedToAppData,
  appDataToTables, refreshCache, getCacheInfo,
} = require("./googleSheetStore");
const { computeDataVersion, buildAtomicUpdateRequests, makeSerializedQueue, assertExpectedVersion } =
  require("./versionedWriterCore");

function createVersionedDataStore({
  getClient = getSheetsClient,
  refresh = refreshCache,
  getCache = getCacheInfo,
  spreadsheetId = SHEET_ID,
} = {}) {
  const enqueueWrite = makeSerializedQueue();

  async function readLiveSnapshot(sheets) {
    // No server cache during concurrency checks.
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
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
    const data = normalizedToAppData(normalizeData(rawTables));
    return { data, version: computeDataVersion(data), originalRows };
  }

  async function getVersionedAppData() {
    return readLiveSnapshot(await getClient());
  }

  async function saveVersionedAppData(data, { expectedVersion, requireVersion = true } = {}) {
    return enqueueWrite(async () => {
      const sheets = await getClient();
      const live = await readLiveSnapshot(sheets);
      if (requireVersion) assertExpectedVersion(expectedVersion, live.version);
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
      });
      const requests = buildAtomicUpdateRequests({
        sheetNames: SHEET_NAMES,
        tableColumns: TABLE_COLUMNS,
        tables: appDataToTables(data),
        originalRows: live.originalRows,
        sheetProperties: metadata.data.sheets || [],
      });
      // All five sheet tabs are changed in one atomic spreadsheets.batchUpdate.
      // The in-process queue only protects one Render instance; direct edits
      // and writes from other instances are outside this lock.
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests, includeSpreadsheetInResponse: false },
      });
      const normalized = await refresh();
      const savedData = normalizedToAppData(normalized);
      return {
        data: savedData,
        version: computeDataVersion(savedData),
        cache: getCache(),
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

  return { getVersionedAppData, saveVersionedAppData, readLiveSnapshot };
}
module.exports = {
  ...createVersionedDataStore(),
  createVersionedDataStore,
};
