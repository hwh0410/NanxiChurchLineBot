const test = require("node:test");
const assert = require("node:assert/strict");
const { isAuthorized } = require("../services/googleAdminAuth");

const headers = ["email", "role", "active", "google_sub"];
const rows = [headers, ["owner@example.com", "admin", "TRUE", "12345"], ["disabled@example.com", "admin", "FALSE", ""], ["viewer@example.com", "viewer", "TRUE", ""]];

test("accepts a verified administrator with matching Google subject", () => {
  assert.equal(isAuthorized(rows, { email: "owner@example.com", sub: "12345" }), true);
});
test("rejects disabled and non-admin accounts", () => {
  assert.equal(isAuthorized(rows, { email: "disabled@example.com", sub: "anything" }), false);
  assert.equal(isAuthorized(rows, { email: "viewer@example.com", sub: "anything" }), false);
});
test("rejects mismatched subject or missing user", () => {
  assert.equal(isAuthorized(rows, { email: "owner@example.com", sub: "different" }), false);
  assert.equal(isAuthorized(rows, { email: "unknown@example.com", sub: "different" }), false);
});
test("fails closed for missing headers and empty lists", () => {
  assert.equal(isAuthorized([], { email: "owner@example.com", sub: "12345" }), false);
  assert.throws(() => isAuthorized([["email", "active"]], { email: "owner@example.com", sub: "12345" }));
});
