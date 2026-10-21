const { createHash } = require("node:crypto");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(
      (key) => [key, canonicalize(value[key])]
    ));
  }
  return value;
}
function computeDataVersion(data) {
  return createHash("sha256").update(JSON.stringify(canonicalize(data))).digest("hex");
}
function buildAtomicUpdateRequests({ sheetNames, tableColumns, tables, originalRows, sheetProperties }) {
  const props = new Map(sheetProperties.map((sheet) => [sheet.properties.title, sheet.properties]));
  const requests = [];
  for (const name of sheetNames) {
    const property = props.get(name);
    if (!property || !Number.isInteger(property.sheetId)) {
      throw new Error("缺少必要工作表：" + name);
    }
    const columns = tableColumns[name];
    if (!columns?.length) throw new Error("缺少工作表欄位：" + name);
    const newRows = [columns, ...(tables[name] || []).map((record) =>
      columns.map((column) => record[column] ?? ""))];
    const targetLength = Math.max(1, (originalRows[name] || []).length, newRows.length);
    const rowCapacity = property.gridProperties?.rowCount ?? 0;
    const colCapacity = property.gridProperties?.columnCount ?? 0;
    if (colCapacity < columns.length) requests.push({ appendDimension: {
      sheetId: property.sheetId, dimension: "COLUMNS", length: columns.length - colCapacity
    } });
    if (targetLength > rowCapacity) requests.push({ appendDimension: {
      sheetId: property.sheetId, dimension: "ROWS", length: targetLength - rowCapacity
    } });
    requests.push({ updateCells: {
      range: { sheetId: property.sheetId, startRowIndex: 0,
        endRowIndex: targetLength, startColumnIndex: 0, endColumnIndex: columns.length },
      rows: newRows.map((row) => ({ values: row.map((cell) => (
        cell === null || cell === undefined || cell === "" ? {} :
        { userEnteredValue: typeof cell === "number"
          ? { numberValue: cell } : { stringValue: String(cell) } }
      )) })),
      fields: "userEnteredValue"
    } });
  }
  return requests;
}
function assertExpectedVersion(expectedVersion, currentVersion) {
  if (!expectedVersion || !/^[a-f0-9]{64}$/.test(expectedVersion)) {
    const error = new Error("儲存時必須提供有效的資料版本，請重新載入。");
    error.code = "VERSION_REQUIRED";
    throw error;
  }
  if (expectedVersion !== currentVersion) {
    const error = new Error("雲端資料已由其他管理員更新，請先重新載入再儲存。");
    error.code = "DATA_CONFLICT";
    error.currentVersion = currentVersion;
    throw error;
  }
}

function makeSerializedQueue() {
  let previous = Promise.resolve();
  return function enqueue(task) {
    const current = previous.then(task);
    previous = current.catch(() => undefined);
    return current;
  };
}
module.exports = { computeDataVersion, buildAtomicUpdateRequests, makeSerializedQueue, assertExpectedVersion };
