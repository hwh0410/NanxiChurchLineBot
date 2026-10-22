const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SHEET_NAMES, TABLE_COLUMNS, rowsToObjects, normalizeData
} = require("../services/googleSheetStore");
const { createVersionedDataStore } = require("../services/versionedDataStore");

function fakeSheets() {
  const valuesByTab = Object.fromEntries(SHEET_NAMES.map((name) => [name, [TABLE_COLUMNS[name]]]));
  const ids = Object.fromEntries(SHEET_NAMES.map((name, index) => [name, index + 10]));
  let batchCalls = 0;
  let failBatch = false;
  const sheets = {
    spreadsheets: {
      values: {
        batchGet: async () => ({ data: { valueRanges: SHEET_NAMES.map((name) => ({
          values: valuesByTab[name].map((row) => [...row])
        })) } }),
      },
      get: async () => ({ data: { sheets: SHEET_NAMES.map((name) => ({
        properties: { title: name, sheetId: ids[name],
          gridProperties: { rowCount: 50, columnCount: 26 } }
      })) } }),
      batchUpdate: async ({ requestBody }) => {
        batchCalls += 1;
        if (failBatch) throw new Error("Injected single-batch failure");
        // Mock Google Sheets applying one complete atomic group.
        const changes = {};
        for (const request of requestBody.requests) {
          if (!request.updateCells) continue;
          const name = SHEET_NAMES.find((tab) => ids[tab] === request.updateCells.range.sheetId);
          if (!name) throw new Error("Unknown fake tab");
          changes[name] = request.updateCells.rows.map((row) =>
            row.values.map((cell) => {
              const val = cell.userEnteredValue;
              return val?.stringValue ?? val?.numberValue ?? "";
            })
          );
        }
        Object.assign(valuesByTab, changes);
      }
    }
  };
  const refresh = async () => normalizeData(Object.fromEntries(SHEET_NAMES.map((name) => [
    name, rowsToObjects(valuesByTab[name])
  ])));
  return {
    sheets, refresh,
    get batchCalls() { return batchCalls; },
    setFail(value) { failBatch = value; }
  };
}

test("two concurrent managers with same version: exactly one succeeds", async () => {
  const mock = fakeSheets();
  const store = createVersionedDataStore({
    getClient: async () => mock.sheets, refresh: mock.refresh,
    getCache: () => ({hasCache:true}),
    spreadsheetId: "fake-only",
  });
  const firstRead = await store.getVersionedAppData();
  const dataA = { ...firstRead.data, schedules: [
    {id:"a",date:"2026-11-01",title:"早禮拜",serviceType:"主日",songs:[]}
  ] };
  const dataB = { ...firstRead.data, schedules: [
    {id:"b",date:"2026-11-01",title:"晚間練習",serviceType:"練習",songs:[]}
  ] };
  const settled = await Promise.allSettled([
    store.saveVersionedAppData(dataA, {expectedVersion:firstRead.version}),
    store.saveVersionedAppData(dataB, {expectedVersion:firstRead.version}),
  ]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  const rejected = settled.find((item) => item.status === "rejected");
  assert.equal(rejected.reason.code, "DATA_CONFLICT");
  assert.equal(mock.batchCalls, 1);
  const latest = await store.getVersionedAppData();
  assert.equal(latest.data.schedules.length, 1);
  assert.notEqual(latest.version, firstRead.version);
});

test("failure before atomic batch applies leaves all five sheets unchanged", async () => {
  const mock = fakeSheets();
  mock.setFail(true);
  const store = createVersionedDataStore({
    getClient: async () => mock.sheets, refresh: mock.refresh,
    spreadsheetId: "fake-only",
  });
  const before = await store.getVersionedAppData();
  const changed = { ...before.data, songs: [{id:"new",title:"測試聖詩",resources:[]}] };
  await assert.rejects(
    store.saveVersionedAppData(changed, {expectedVersion:before.version}),
    /Injected single-batch failure/
  );
  const after = await store.getVersionedAppData();
  assert.equal(after.version, before.version);
  assert.equal(after.data.songs.length, 0);
  assert.equal(mock.batchCalls, 1);
});
