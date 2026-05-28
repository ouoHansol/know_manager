import "dotenv/config";
import { chromium } from "playwright";

const keywords = /(과제|출석|대체|성적|학점|수강|시험|학사)/;
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

const pages = [
  page.url(),
  "https://www.knou.ac.kr/knou/index.do",
  "https://ucampus.knou.ac.kr/ekp/user/study/retrieveUMYStudy.sdo",
];

const seen = new Set();
for (const url of pages) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a")]
      .map((anchor) => ({
        text: anchor.innerText.replace(/\s+/g, " ").trim(),
        href: anchor.href,
      }))
      .filter((item) => item.text || item.href)
  );
  for (const link of links) {
    const key = `${link.text}|${link.href}`;
    if (seen.has(key)) continue;
    if (!keywords.test(`${link.text} ${link.href}`)) continue;
    seen.add(key);
    console.log(`${link.text}\t${link.href}`);
  }
}

await browser.close();
