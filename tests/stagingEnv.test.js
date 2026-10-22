const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const prodDefaultId = "14_073x7K5uy9sbsdKSWKzmpqXJct9l1Bz1JviKOYoaA";
function tryLoadStore(overrides) {
  return spawnSync(process.execPath,
    ["-e", "require('./services/googleSheetStore'); process.stdout.write('PASS')"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20000,
      env: { ...process.env, STAGING_MODE: "true",
        GOOGLE_SHEET_ID: "isolated-staging-test-spreadsheet",
        ADMIN_SHEET_ID: "isolated-staging-test-spreadsheet",
        LINE_WEBHOOK_ENABLED: "false", ...overrides } }
  );
}
test("staging must specify a different Sheet instead of production default", () => {
  for(const value of ["", prodDefaultId]) {
    const r = tryLoadStore({ GOOGLE_SHEET_ID: value });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /requires a separate GOOGLE_SHEET_ID/);
  }
});
test("staging refuses active LINE webhook", () => {
  const r = tryLoadStore({ LINE_WEBHOOK_ENABLED: "true" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /LINE_WEBHOOK_ENABLED=false/);
});
test("staging requires an explicit administrator sheet", () => {
  const r = tryLoadStore({ ADMIN_SHEET_ID: "" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ADMIN_SHEET_ID/);
});
test("isolated staging settings start without loading production credentials", () => {
  const r = tryLoadStore({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "PASS");
});
