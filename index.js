const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");

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

app.get("/", (req, res) => {
  res.send("Nanxi LINE bot is running");
});

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message?.type !== "text") continue;

      const userText = event.message.text.trim();

      let replyText =
        "請輸入「本週行程」或「本週曲目」，我會回覆最近一次聖歌隊安排。";

      if (userText.includes("本週") || userText.includes("曲目")) {
        replyText = await getLatestScheduleText();
      }

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: "text", text: replyText }],
      });
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(200).send("OK");
  }
});

async function getLatestScheduleText() {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const scheduleResponse = await axios.get(
      `${SUPABASE_URL}/rest/v1/schedules?select=*&date=gte.${today}&order=date.asc&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const schedules = scheduleResponse.data || [];

    if (schedules.length === 0) {
      return "目前尚未建立未來排程。";
    }

    const schedule = schedules[0];

    const scheduleSongsResponse = await axios.get(
      `${SUPABASE_URL}/rest/v1/schedule_songs?select=*&schedule_id=eq.${schedule.id}&order=sort_order.asc`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }
    );

    const scheduleSongs = scheduleSongsResponse.data || [];

    let replyText = [
      "📅 本週行程",
      `${schedule.date}｜${schedule.service_type || "主日"}｜${schedule.title}`,
      schedule.note ? `備註：${schedule.note}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    if (scheduleSongs.length === 0) {
      return `${replyText}\n尚未加入曲目。\n\n完整練習平台：\n${PLATFORM_URL}`;
    }

    for (const item of scheduleSongs) {
      const songResponse = await axios.get(
        `${SUPABASE_URL}/rest/v1/songs?select=*&id=eq.${item.song_id}&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const song = (songResponse.data || [])[0];

      if (!song) {
        replyText += `\n🎵 ${item.title || "未知曲目"}\n`;
        continue;
      }

      replyText += `\n🎵 ${item.usage_type || "曲目"}：${song.title}`;
      replyText += `\n調性：${song.song_key || "-"}｜速度：${song.tempo || "-"}`;

      const resourcesResponse = await axios.get(
        `${SUPABASE_URL}/rest/v1/song_resources?select=*&song_id=eq.${song.id}&order=created_at.asc`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const resources = resourcesResponse.data || [];

      if (resources.length > 0) {
        replyText += "\n練習資源：";
        resources.forEach((resource) => {
          replyText += `\n・${resource.voice_part || "全體"}｜${resource.title}`;
          replyText += `\n  ${resource.url}`;
        });
      } else {
        replyText += "\n尚未建立練習資源。";
      }

      replyText += "\n";
    }

    replyText += `\n完整練習平台：\n${PLATFORM_URL}`;

    if (replyText.length > 4800) {
      replyText =
        replyText.slice(0, 4600) +
        `\n\n內容較多，請至平台查看完整教材：\n${PLATFORM_URL}`;
    }

    return replyText;
  } catch (error) {
    console.error("讀取資料失敗:", error.response?.data || error.message);
    return "讀取資料失敗，請稍後再試。";
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Bot running on ${PORT}`);
});