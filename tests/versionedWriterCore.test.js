const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeDataVersion, buildAtomicUpdateRequests, makeSerializedQueue
} = require("../services/versionedWriterCore");

test("revision is stable against object key order, but changes when a song changes", () => {
  const a = { schedules: [{ id: "a", title: "主日" }], songs: [{ id: "one" }] };
  const b = { songs: [{ id: "one" }], schedules: [{ title: "主日", id: "a" }] };
  assert.equal(computeDataVersion(a), computeDataVersion(b));
  assert.notEqual(computeDataVersion(a), computeDataVersion({
    ...b, songs: [{ id: "two" }]
  }));
});

test("one request atomically writes multiple worksheets and clears removed trailing rows", () => {
  const requests = buildAtomicUpdateRequests({
    sheetNames: ["schedules", "songs"],
    tableColumns: { schedules: ["id", "title"], songs: ["id"] },
    tables: { schedules: [{ id: "sch-1", title: "聚會" }], songs: [] },
    originalRows: {
      schedules: [["id", "title"], ["old", "old-title"], ["deleted", "removed"]],
      songs: [["id"], ["song-to-delete"]]
    },
    sheetProperties: [
      { properties: { title: "schedules", sheetId: 101, gridProperties: { rowCount: 100, columnCount: 26 } } },
      { properties: { title: "songs", sheetId: 102, gridProperties: { rowCount: 100, columnCount: 26 } } }
    ],
  });
  assert.equal(requests.length, 2);
  const [schedule, song] = requests.map(x => x.updateCells);
  assert.equal(schedule.range.sheetId, 101);
  assert.equal(schedule.range.endRowIndex, 3);
  assert.equal(schedule.rows.length, 2);
  assert.equal(schedule.fields, "userEnteredValue");
  assert.deepEqual(schedule.rows[1].values[0].userEnteredValue, { stringValue: "sch-1" });
  assert.equal(song.range.endRowIndex, 2);
  assert.equal(song.rows.length, 1); // second row is cleared by updateCells range/fields
});

test("expands row capacity inside the same atomic batch when needed", () => {
  const result = buildAtomicUpdateRequests({
    sheetNames: ["songs"], tableColumns: { songs: ["id", "order"] },
    tables: { songs: [{ id: "a", order: 3 }, { id: "b", order: 4 }] },
    originalRows: { songs: [["id", "order"]] },
    sheetProperties: [
      { properties: { title: "songs", sheetId: 7, gridProperties: { rowCount: 2, columnCount: 1 } } }
    ],
  });
  assert.deepEqual(result.slice(0, 2).map(x => x.appendDimension.dimension), ["COLUMNS", "ROWS"]);
  assert.equal(result[2].updateCells.rows[1].values[1].userEnteredValue.numberValue, 3);
});
test("missing worksheet fails before a write request exists", () => {
  assert.throws(() => buildAtomicUpdateRequests({
    sheetNames: ["songs"], tableColumns: { songs: ["id"] }, tables: {},
    originalRows: {}, sheetProperties: []
  }), /缺少必要工作表/);
});

test("concurrent writers are serialized; a rejected save does not deadlock later ones", async () => {
  const enqueue = makeSerializedQueue();
  const sequence = [];
  const first = enqueue(async () => {
    sequence.push("first-start");
    await new Promise(resolve => setTimeout(resolve, 15));
    sequence.push("first-end");
    throw new Error("failure");
  });
  const second = enqueue(async () => {
    sequence.push("second");
    return 2;
  });
  await assert.rejects(first, /failure/);
  assert.equal(await second, 2);
  assert.deepEqual(sequence, ["first-start", "first-end", "second"]);
});
