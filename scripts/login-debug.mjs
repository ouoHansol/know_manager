import "dotenv/config";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: process.env.KNOU_HEADLESS !== "false" });
const page = await browser.newPage({ locale: "ko-KR", viewport: { width: 1440, height: 1100 } });

await page.goto("https://ucampus.knou.ac.kr/ekp/user/login/retrieveULOLogin.do", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.locator("#username").fill(process.env.KNOU_ID || "");
await page.locator("#password").fill(process.env.KNOU_PASSWORD || "");
await Promise.all([
  page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {}),
  page.locator("button:has-text('로그인')").last().click(),
]);
await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
await page.screenshot({ path: "data/login-debug.png", fullPage: true });

const info = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  text: document.body?.innerText?.slice(0, 3000) || "",
  links: [...document.querySelectorAll("a")]
    .map((a) => ({ text: a.innerText.trim(), href: a.href }))
    .filter((item) => item.text || item.href)
    .slice(0, 120),
}));

await writeFile("data/login-debug.json", JSON.stringify(info, null, 2), "utf-8");
console.log(JSON.stringify({ title: info.title, url: info.url, text: info.text.slice(0, 800) }, null, 2));
await browser.close();
