// Read-only staging smoke test. Never sends POST and never touches production.
const rawUrl = process.env.STAGING_API_BASE_URL;
if (!rawUrl) {
  console.error("Set STAGING_API_BASE_URL to the independently deployed staging Render service.");
  process.exit(1);
}
const url = new URL(rawUrl);
if (url.protocol !== "https:" ||
    !url.hostname.endsWith(".onrender.com") ||
    url.hostname === "nanxichurchlinebot.onrender.com") {
  console.error("Refusing a non-HTTPS, non-Render or known production API target.");
  process.exit(1);
}
async function main() {
  const res = await fetch(new URL("/api/data/v2", url), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new Error("Staging v2 GET returned " + res.status);
  const body = await res.json();
  if (!/^[a-f0-9]{64}$/.test(body.version || "")) {
    throw new Error("Missing v2 revision version.");
  }
  const schedules = body.data?.schedules || [];
  const songs = body.data?.songs || [];
  if (!schedules.some((item) => item.id === "stage-sch-001") ||
      !songs.some((item) => item.id === "stage-song-001")) {
    throw new Error("Staging fixtures missing: check GOOGLE_SHEET_ID; do not point at live choir data.");
  }
  console.log("Staging GET /api/data/v2 OK; fixtures present, version valid, no writes performed.");
}
main().catch((e) => { console.error("Staging smoke test failed:", e.message); process.exit(1); });
