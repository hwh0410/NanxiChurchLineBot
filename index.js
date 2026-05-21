const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const {
  getCachedData,
  refreshCache,
  getCacheInfo,
} = require("./services/googleSheetStore");

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PLATFORM_URL =
  process.env.PLATFORM_URL || "https://hwh0410.github.io/NanxiChurchChoir/";

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

app.get("/", (req, res) => {
  res.send("Nanxi LINE bot is running");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "nanxi-line-bot",
    time: new Date().toISOString(),
  });
});

app.get("/cache-info", (req, res) => {
  res.status(200).json({
    status: "ok",
    cache: getCacheInfo(),
    time: new Date().toISOString(),
  });
});

app.post("/refresh-cache", async (req, res) => {
  try {
    const data = await refreshCache();

    res.status(200).json({
      status: "ok",
      cache: getCacheInfo(),
      counts: {
        schedules: data.schedules.length,
        scheduleSongs: data.scheduleSongs.length,
        songs: data.songs.length,
        songResources: data.songResources.length,
        archiveVideos: data.archiveVideos.length,
      },
    });
  } catch (error) {
    console.error("Refresh cache error:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const userText = event.message.text.trim();
      const messages = await handleTextMessage(userText);

      await client.replyMessage({
        replyToken: event.replyToken,
        messages,
      });
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(200).send("OK");
  }
});

async function handleTextMessage(text) {
  if (text === "選單" || text === "menu" || text === "幫助") {
    return [makeHelpMessage()];
  }

  if (text.includes("下週")) {
    const schedule = await getScheduleByOffset(1);
    return [makeScheduleFlex(schedule, "下週行程")];
  }

  if (text.includes("本週") || text.includes("本週行程") || text.includes("本週曲目")) {
    const schedule = await getScheduleByOffset(0);
    return [makeScheduleFlex(schedule, "本週行程")];
  }

  if (text.startsWith("查")) {
    const keyword = text.replace("查", "").trim();
    const songs = await searchSongs(keyword);
    return [makeSongSearchFlex(keyword, songs)];
  }

  if (text.startsWith("練習資源")) {
    const keyword = text.replace("練習資源", "").trim();
    const songs = await searchSongs(keyword);
    if (!songs.length) return [makeText(`找不到「${keyword}」的曲目。`)];
    return [makeSongResourceFlex(songs[0])];
  }

  if (text.includes("歷年影片") || text.includes("演唱影片")) {
    const videos = await getArchiveVideos();
    return [makeArchiveVideosFlex(videos, "歷年演唱影片")];
  }

  if (text.startsWith("查影片")) {
    const keyword = text.replace("查影片", "").trim();
    const videos = await searchArchiveVideos(keyword);
    return [makeArchiveVideosFlex(videos, `影片查詢：${keyword}`)];
  }

  if (text.includes("平台") || text.includes("網址")) {
    return [
      makeText(`楠西教會聖歌隊練習平台：\n${PLATFORM_URL}`),
    ];
  }

  return [makeHelpMessage()];
}

function makeText(text) {
  return {
    type: "text",
    text,
    quickReply: makeQuickReply(),
  };
}

function makeHelpMessage() {
  return {
    type: "text",
    text:
      "請選擇功能，或直接輸入：\n\n" +
      "・本週行程\n" +
      "・下週行程\n" +
      "・查 曲名\n" +
      "・練習資源 曲名\n" +
      "・歷年影片\n" +
      "・查影片 關鍵字\n" +
      "・平台",
    quickReply: makeQuickReply(),
  };
}

function makeQuickReply() {
  return {
    items: [
      {
        type: "action",
        action: {
          type: "message",
          label: "本週行程",
          text: "本週行程",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "下週行程",
          text: "下週行程",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "查曲目",
          text: "查 ",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "練習資源",
          text: "練習資源 ",
        },
      },
      {
        type: "action",
        action: {
          type: "message",
          label: "歷年影片",
          text: "歷年影片",
        },
      },
      {
        type: "action",
        action: {
          type: "uri",
          label: "開啟平台",
          uri: PLATFORM_URL,
        },
      },
    ],
  };
}


async function getScheduleByOffset(offsetWeeks) {
  try {
    const data = await getCachedData();
    const today = new Date();
    const start = new Date(today);

    start.setDate(today.getDate() + offsetWeeks * 7);

    const startDate = start.toISOString().slice(0, 10);

    const schedule = data.schedulesWithSongs.find(
      (item) => String(item.date || "") >= startDate
    );

    return schedule || null;
  } catch (error) {
    console.error("Google Sheet getScheduleByOffset failed, fallback to Supabase:", error.message);
    return getScheduleByOffsetFromSupabase(offsetWeeks);
  }
}

async function getSongById(songId) {
  try {
    const data = await getCachedData();
    return data.songsById.get(songId) || null;
  } catch (error) {
    console.error("Google Sheet getSongById failed, fallback to Supabase:", error.message);
    return getSongByIdFromSupabase(songId);
  }
}

async function getResourcesBySongId(songId) {
  try {
    const data = await getCachedData();
    return data.resourcesBySongId.get(songId) || [];
  } catch (error) {
    console.error("Google Sheet getResourcesBySongId failed, fallback to Supabase:", error.message);
    return getResourcesBySongIdFromSupabase(songId);
  }
}

async function searchSongs(keyword) {
  try {
    if (!keyword) return [];

    const data = await getCachedData();
    const normalizedKeyword = keyword.toLowerCase();

    return data.songs
      .filter((song) => String(song.title || "").toLowerCase().includes(normalizedKeyword))
      .slice(0, 5)
      .map((song) => ({
        ...song,
        resources: data.resourcesBySongId.get(song.id) || [],
      }));
  } catch (error) {
    console.error("Google Sheet searchSongs failed, fallback to Supabase:", error.message);
    return searchSongsFromSupabase(keyword);
  }
}

async function getArchiveVideos() {
  try {
    const data = await getCachedData();

    return [...data.archiveVideos]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 10);
  } catch (error) {
    console.error("Google Sheet getArchiveVideos failed, fallback to Supabase:", error.message);
    return getArchiveVideosFromSupabase();
  }
}

async function searchArchiveVideos(keyword) {
  try {
    if (!keyword) return [];

    const data = await getCachedData();
    const normalizedKeyword = keyword.toLowerCase();

    return data.archiveVideos
      .filter((video) =>
        String(video.title || "").toLowerCase().includes(normalizedKeyword) ||
        String(video.description || "").toLowerCase().includes(normalizedKeyword) ||
        String(video.tags || "").toLowerCase().includes(normalizedKeyword)
      )
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 10);
  } catch (error) {
    console.error("Google Sheet searchArchiveVideos failed, fallback to Supabase:", error.message);
    return searchArchiveVideosFromSupabase(keyword);
  }
}

async function getScheduleByOffsetFromSupabase(offsetWeeks) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() + offsetWeeks * 7);

  const startDate = start.toISOString().slice(0, 10);

  const scheduleResponse = await axios.get(
    `${SUPABASE_URL}/rest/v1/schedules?select=*&date=gte.${startDate}&order=date.asc&limit=1`,
    { headers }
  );

  const schedule = (scheduleResponse.data || [])[0];

  if (!schedule) {
    return null;
  }

  const scheduleSongsResponse = await axios.get(
    `${SUPABASE_URL}/rest/v1/schedule_songs?select=*&schedule_id=eq.${schedule.id}&order=sort_order.asc`,
    { headers }
  );

  const scheduleSongs = scheduleSongsResponse.data || [];

  const songsWithResources = [];

  for (const item of scheduleSongs) {
    const song = await getSongByIdFromSupabase(item.song_id);

    if (song) {
      const resources = await getResourcesBySongIdFromSupabase(song.id);
      songsWithResources.push({
        usageType: item.usage_type || "曲目",
        song,
        resources,
      });
    }
  }

  return {
    ...schedule,
    songs: songsWithResources,
  };
}

async function getSongByIdFromSupabase(songId) {
  const response = await axios.get(
    `${SUPABASE_URL}/rest/v1/songs?select=*&id=eq.${songId}&limit=1`,
    { headers }
  );

  return (response.data || [])[0] || null;
}

async function getResourcesBySongIdFromSupabase(songId) {
  const response = await axios.get(
    `${SUPABASE_URL}/rest/v1/song_resources?select=*&song_id=eq.${songId}&order=created_at.asc`,
    { headers }
  );

  return response.data || [];
}

async function searchSongsFromSupabase(keyword) {
  if (!keyword) return [];

  const response = await axios.get(
    `${SUPABASE_URL}/rest/v1/songs?select=*&title=ilike.*${encodeURIComponent(keyword)}*&order=created_at.desc&limit=5`,
    { headers }
  );

  const songs = response.data || [];

  const result = [];

  for (const song of songs) {
    const resources = await getResourcesBySongIdFromSupabase(song.id);
    result.push({
      ...song,
      resources,
    });
  }

  return result;
}

function makeScheduleFlex(schedule, title) {
  if (!schedule) {
    return {
      type: "text",
      text: `目前尚未建立${title}。`,
      quickReply: makeQuickReply(),
    };
  }

  const songContents =
    schedule.songs.length === 0
      ? [
          {
            type: "text",
            text: "尚未加入曲目。",
            color: "#64748b",
            size: "sm",
          },
        ]
      : schedule.songs.flatMap((item, index) => {
          const song = item.song;
          const resources = item.resources || [];
          const youtube = resources.find((r) => r.type === "youtube");
          const score = resources.find((r) => r.type === "score");

          const buttons = [];

          if (youtube) {
            buttons.push({
              type: "button",
              style: "primary",
              height: "sm",
              action: {
                type: "uri",
                label: "觀看練習影片",
                uri: youtube.url,
              },
            });
          }

          if (score) {
            buttons.push({
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "uri",
                label: "開啟樂譜",
                uri: score.url,
              },
            });
          }

          buttons.push({
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "uri",
              label: "完整教材",
              uri: PLATFORM_URL,
            },
          });

          return [
            {
              type: "box",
              layout: "vertical",
              spacing: "xs",
              margin: index === 0 ? "md" : "lg",
              contents: [
                {
                  type: "text",
                  text: `${index + 1}. ${item.usageType}｜${song.title}`,
                  weight: "bold",
                  size: "md",
                  wrap: true,
                },
                {
                  type: "text",
                  text: `調性：${song.song_key || "-"}｜速度：${song.tempo || "-"}`,
                  color: "#64748b",
                  size: "sm",
                  wrap: true,
                },
                {
                  type: "text",
                  text: resources.length
                    ? `資源數：${resources.length}`
                    : "尚未建立練習資源",
                  color: "#64748b",
                  size: "sm",
                  wrap: true,
                },
                ...buttons,
              ],
            },
          ];
        });

  return {
    type: "flex",
    altText: `${title}：${schedule.title}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: title,
            weight: "bold",
            size: "lg",
            color: "#1e3a8a",
          },
          {
            type: "text",
            text: `${schedule.date}｜${schedule.service_type || "主日"}`,
            size: "sm",
            color: "#64748b",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: schedule.title,
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          schedule.note
            ? {
                type: "text",
                text: `備註：${schedule.note}`,
                color: "#475569",
                size: "sm",
                wrap: true,
              }
            : {
                type: "text",
                text: " ",
                size: "xs",
              },
          ...songContents,
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: "開啟練習平台",
              uri: PLATFORM_URL,
            },
          },
        ],
      },
    },
    quickReply: makeQuickReply(),
  };
}

function makeSongSearchFlex(keyword, songs) {
  if (!keyword) {
    return makeText("請輸入要查詢的曲名，例如：查 奇異恩典");
  }

  if (!songs.length) {
    return makeText(`找不到「${keyword}」相關曲目。`);
  }

  return {
    type: "flex",
    altText: `查詢曲目：${keyword}`,
    contents: {
      type: "carousel",
      contents: songs.slice(0, 5).map((song) => {
        const youtube = (song.resources || []).find((r) => r.type === "youtube");
        const score = (song.resources || []).find((r) => r.type === "score");

        const buttons = [];

        if (youtube) {
          buttons.push({
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: "觀看影片",
              uri: youtube.url,
            },
          });
        }

        if (score) {
          buttons.push({
            type: "button",
            style: "secondary",
            action: {
              type: "uri",
              label: "開啟樂譜",
              uri: score.url,
            },
          });
        }

        buttons.push({
          type: "button",
          style: "link",
          action: {
            type: "message",
            label: "列出全部資源",
            text: `練習資源 ${song.title}`,
          },
        });

        return {
          type: "bubble",
          size: "micro",
          body: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: song.title,
                weight: "bold",
                size: "md",
                wrap: true,
              },
              {
                type: "text",
                text: `調性：${song.song_key || "-"}｜速度：${song.tempo || "-"}`,
                size: "xs",
                color: "#64748b",
                wrap: true,
              },
              {
                type: "text",
                text: `資源數：${(song.resources || []).length}`,
                size: "xs",
                color: "#64748b",
              },
            ],
          },
          footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: buttons,
          },
        };
      }),
    },
    quickReply: makeQuickReply(),
  };
}

function makeSongResourceFlex(song) {
  const resources = song.resources || [];

  if (!resources.length) {
    return makeText(`「${song.title}」尚未建立練習資源。`);
  }

  const contents = resources.slice(0, 10).map((resource) => ({
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    contents: [
      {
        type: "text",
        text: `${resource.voice_part || "全體"}｜${resource.title}`,
        weight: "bold",
        size: "sm",
        wrap: true,
      },
      {
        type: "button",
        style: resource.type === "youtube" ? "primary" : "secondary",
        height: "sm",
        action: {
          type: "uri",
          label:
            resource.type === "youtube"
              ? "觀看影片"
              : resource.type === "score"
              ? "開啟樂譜"
              : "開啟資源",
          uri: resource.url,
        },
      },
    ],
  }));

  return {
    type: "flex",
    altText: `${song.title} 練習資源`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "練習資源",
            weight: "bold",
            color: "#1e3a8a",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: song.title,
            weight: "bold",
            size: "xl",
            wrap: true,
          },
          {
            type: "text",
            text: `調性：${song.song_key || "-"}｜速度：${song.tempo || "-"}`,
            size: "sm",
            color: "#64748b",
          },
          ...contents,
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "link",
            action: {
              type: "uri",
              label: "開啟完整平台",
              uri: PLATFORM_URL,
            },
          },
        ],
      },
    },
    quickReply: makeQuickReply(),
  };
}

async function getArchiveVideosFromSupabase() {
  const response = await axios.get(
    `${SUPABASE_URL}/rest/v1/archive_videos?select=*&order=date.desc&limit=10`,
    { headers }
  );

  return response.data || [];
}

async function searchArchiveVideosFromSupabase(keyword) {
  if (!keyword) return [];

  const response = await axios.get(
    `${SUPABASE_URL}/rest/v1/archive_videos?select=*&title=ilike.*${encodeURIComponent(
      keyword
    )}*&order=date.desc&limit=10`,
    { headers }
  );

  return response.data || [];
}

function makeArchiveVideosFlex(videos, title) {
  if (!videos.length) {
    return makeText(`目前找不到「${title}」相關影片。`);
  }

  return {
    type: "flex",
    altText: title,
    contents: {
      type: "carousel",
      contents: videos.slice(0, 10).map((video) => ({
        type: "bubble",
        size: "micro",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "text",
              text: video.title,
              weight: "bold",
              size: "md",
              wrap: true,
            },
            {
              type: "text",
              text: `${video.date || "未填日期"}｜${
                video.event_name || "未填場合"
              }`,
              size: "xs",
              color: "#64748b",
              wrap: true,
            },
            {
              type: "text",
              text: video.description || " ",
              size: "xs",
              color: "#64748b",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: "觀看影片",
                uri: video.youtube_url,
              },
            },
            {
              type: "button",
              style: "link",
              action: {
                type: "uri",
                label: "開啟平台",
                uri: PLATFORM_URL,
              },
            },
          ],
        },
      })),
    },
    quickReply: makeQuickReply(),
  };
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Bot running on ${PORT}`);

  refreshCache()
    .then(() => {
      console.log("Google Sheet cache loaded on startup", getCacheInfo());
    })
    .catch((error) => {
      console.error("Google Sheet cache load failed on startup:", error.message);
      console.error("Bot will fallback to Supabase when needed.");
    });
});