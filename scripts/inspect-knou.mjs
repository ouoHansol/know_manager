import "dotenv/config";
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: process.env.KNOU_HEADLESS !== "false" });
const page = await browser.newPage({ locale: "ko-KR", viewport: { width: 1440, height: 1100 } });

for (const url of [
  process.env.KNOU_START_URL || "https://www.knou.ac.kr/index.jsp",
  process.env.KNOU_UCAMPUS_URL || "https://ucampus.knou.ac.kr/ekp/user/main/retrieveUIXMain.do",
]) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const safeName = new URL(url).hostname.replace(/\W/g, "_");
  await page.screenshot({ path: `data/inspect-${safeName}.png`, fullPage: true });
  await writeFile(`data/inspect-${safeName}.html`, await page.content(), "utf-8");
  const info = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    inputs: [...document.querySelectorAll("input")].slice(0, 30).map((input) => ({
      type: input.type,
      id: input.id,
      name: input.name,
      placeholder: input.placeholder,
      value: input.type === "password" ? "" : input.value,
    })),
    buttons: [...document.querySelectorAll("button,input[type=submit],a")]
      .slice(0, 80)
      .map((element) => ({
        tag: element.tagName,
        id: element.id,
        name: element.getAttribute("name"),
        text: element.innerText || element.value || element.getAttribute("title") || "",
        href: element.href || "",
      })),
    bodyText: document.body?.innerText?.slice(0, 2500) || "",
  }));
  console.log(JSON.stringify(info, null, 2));
}

await browser.close();
