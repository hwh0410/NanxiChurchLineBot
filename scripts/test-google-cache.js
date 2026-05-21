const {
  loadAllDataFromSheet,
  getCacheInfo,
} = require("../services/googleSheetStore");

async function main() {
  console.log("開始測試 Google Sheet 資料快取...");
  console.log("");

  const data = await loadAllDataFromSheet();

  console.log("讀取結果：");
  console.log(`schedules：${data.schedules.length} 筆`);
  console.log(`scheduleSongs：${data.scheduleSongs.length} 筆`);
  console.log(`songs：${data.songs.length} 筆`);
  console.log(`songResources：${data.songResources.length} 筆`);
  console.log(`archiveVideos：${data.archiveVideos.length} 筆`);
  console.log(`schedulesWithSongs：${data.schedulesWithSongs.length} 筆`);
  console.log("");

  console.log("快取狀態：");
  console.log(getCacheInfo());
  console.log("");

  const nextSchedule = data.schedulesWithSongs.find(
    (schedule) => (schedule.songs || []).length > 0
  );

  if (nextSchedule) {
    console.log("排程範例：");
    console.log(`${nextSchedule.date}｜${nextSchedule.title}`);
    console.log(`曲目數：${nextSchedule.songs.length}`);

    for (const item of nextSchedule.songs) {
      console.log(
        `- ${item.usageType}｜${item.song.title}｜資源數：${item.resources.length}`
      );
    }
  } else {
    console.log("目前沒有含曲目的排程。");
  }

  console.log("");
  console.log("Google Sheet 快取測試成功。");
}

main().catch((error) => {
  console.error("Google Sheet 快取測試失敗：");
  console.error(error.message);
  process.exit(1);
});
