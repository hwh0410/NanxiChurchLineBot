const fs = require("fs");

const filePath = ".secrets/google-service-account.json";

if (!fs.existsSync(filePath)) {
  console.error(`找不到 ${filePath}`);
  process.exit(1);
}

const json = JSON.parse(fs.readFileSync(filePath, "utf-8"));

console.log(JSON.stringify(json));
