// Verify Google Identity Services ID tokens and check a privately shared Sheet.
// ADMIN_SHEET_ID must reference a spreadsheet that is NOT writable by members.
const { OAuth2Client } = require("google-auth-library");
const { getSheetsClient } = require("./googleSheetStore");

const client = new OAuth2Client();
const TAB = "admin_users";

function adminError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isEnabled(value) {
  return ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function isAuthorized(rows, identity) {
  if (!rows?.length) return false;
  const headers = rows[0].map((value) => String(value).trim().toLowerCase());
  const get = (row, column) => {
    const index = headers.indexOf(column);
    return index < 0 ? "" : String(row[index] ?? "").trim();
  };
  if (!["email", "role", "active"].every((key) => headers.includes(key))) {
    throw adminError(503, "管理員名單缺少 email、role 或 active 欄位。");
  }
  return rows.slice(1).some((row) => {
    const email = get(row, "email").toLowerCase();
    const sub = get(row, "google_sub");
    return email === identity.email &&
      get(row, "role").toLowerCase() === "admin" &&
      isEnabled(get(row, "active")) &&
      (!sub || sub === identity.sub);
  });
}

async function verifyGoogleAdmin(req) {
  const audience = process.env.GOOGLE_CLIENT_ID;
  const spreadsheetId = process.env.ADMIN_SHEET_ID;
  if (!audience || !spreadsheetId) {
    throw adminError(503, "Google 管理員登入尚未設定完成。");
  }

  const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ""));
  if (!match) throw adminError(401, "請使用 Google 帳號登入。");

  let identity;
  try {
    const ticket = await client.verifyIdToken({ idToken: match[1], audience });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || !payload.email || !payload.sub) {
      throw new Error("Missing verified Google identity.");
    }
    identity = {
      email: String(payload.email).toLowerCase(),
      sub: String(payload.sub),
    };
  } catch (_error) {
    throw adminError(401, "Google 登入已失效，請重新登入。");
  }

  let rows;
  try {
    const sheets = await getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A1:D`,
    });
    rows = response.data.values || [];
  } catch (error) {
    console.error("Admin allowlist lookup failed:", error.message);
    throw adminError(503, "無法讀取管理員授權名單，已暫停修改功能。");
  }

  if (!isAuthorized(rows, identity)) {
    throw adminError(403, "此 Google 帳號沒有詩班管理權限。");
  }
  return identity;
}

async function requireGoogleAdmin(req, res) {
  try {
    return await verifyGoogleAdmin(req);
  } catch (error) {
    res.status(error.status || 503).json({
      status: "error",
      message: error.message || "管理員授權失敗。",
    });
    return null;
  }
}

module.exports = { requireGoogleAdmin, verifyGoogleAdmin, isAuthorized };
