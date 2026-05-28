import "dotenv/config";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, "public", "data", "knou-events.json");

const config = {
  id: process.env.KNOU_ID,
  password: process.env.KNOU_PASSWORD,
  headless: process.env.KNOU_HEADLESS !== "false",
  startUrl: process.env.KNOU_START_URL || "https://www.knou.ac.kr/index.jsp",
  ucampusUrl: process.env.KNOU_UCAMPUS_URL || "https://ucampus.knou.ac.kr/ekp/user/main/retrieveUIXMain.do",
  extraUrls: (process.env.KNOU_EXTRA_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
};

if (!config.id || !config.password) {
  console.error("KNOU_ID/KNOU_PASSWORD가 없습니다. .env 파일을 채우세요.");
  process.exit(1);
}

await mkdir(dirname(outputPath), { recursive: true });

const browser = await chromium.launch({ headless: config.headless });
const context = await browser.newContext({
  locale: "ko-KR",
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();

const collected = [];
const errors = [];

try {
  await openAndMaybeLogin(page, "https://ucampus.knou.ac.kr/ekp/user/login/retrieveULOLogin.do");
  await collectFromCurrentPage(page, "U-KNOU", collected);
  await collectNotices(page, "U-KNOU 공지", collected);

  await openAndMaybeLogin(page, config.startUrl);
  await collectFromCurrentPage(page, "KNOU 메인", collected);
  await collectNotices(page, "방통대 공지", collected);

  for (const url of config.extraUrls) {
    await openAndMaybeLogin(page, url);
    await collectFromCurrentPage(page, url, collected);
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

const events = dedupeEvents(collected);
await writeFile(
  outputPath,
  JSON.stringify(
    {
      syncedAt: new Date().toISOString(),
      source: "knou-playwright",
      errors,
      events,
    },
    null,
    2
  ),
  "utf-8"
);

console.log(`수집 완료: ${events.length}개 -> ${outputPath}`);
if (errors.length) {
  console.log(`주의: ${errors.join(" | ")}`);
}

async function openAndLogin(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await loginIfVisible(page);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
}

async function openAndMaybeLogin(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await loginIfVisible(page);
}

async function loginIfVisible(page) {
  await followLoginLinkIfNeeded(page);

  const idInput = await firstUsable(page, [
    "#username",
    "input[name='id']",
    "input[name='userId']",
    "input[name='user_id']",
    "input[name*='login' i]",
    "input[name*='user' i]",
    "input[id*='id' i]",
    "input[type='text']",
  ]);
  const passwordInput = await firstUsable(page, [
    "input[type='password']",
    "input[name*='pass' i]",
    "input[id*='pass' i]",
  ]);

  if (!idInput || !passwordInput) return false;

  await idInput.fill(config.id);
  await passwordInput.fill(config.password);

  const submit = await firstUsable(page, [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('로그인')",
    "a:has-text('로그인')",
  ]);

  if (submit) {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {}),
      submit.click(),
    ]);
  } else {
    await passwordInput.press("Enter");
  }

  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  return true;
}

async function followLoginLinkIfNeeded(page) {
  const visiblePassword = await firstUsable(page, ["input[type='password']"]);
  if (visiblePassword) return;

  const candidates = [
    "#btnLogin",
    "a[href*='login' i]:has-text('로그인')",
    "a:has-text('로그인')",
    "button:has-text('로그인')",
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) continue;
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      locator.click({ timeout: 5000 }),
    ]).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    return;
  }
}

async function firstUsable(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    const enabled = await locator.isEnabled().catch(() => false);
    if (visible && enabled) return locator;
  }
  return null;
}

async function collectFromCurrentPage(page, source, collected) {
  await expandLikelyMenus(page);

  const texts = await page
    .locator("body")
    .innerText({ timeout: 15000 })
    .catch(() => "");

  for (const event of parseEventsFromText(texts, source, page.url())) {
    collected.push(event);
  }
}

async function collectNotices(page, source, collected) {
  const noticeUrls = [
    "https://ucampus.knou.ac.kr/ekp/user/notice/initUBDNotice.do",
    "https://www.knou.ac.kr/knou/561/subview.do",
    "https://www.knou.ac.kr/knou/47/subview.do",
  ];

  for (const url of noticeUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const notices = await page
      .evaluate(() => {
        const anchors = [...document.querySelectorAll("a")];
        return anchors
          .map((anchor) => ({
            title: anchor.innerText.replace(/\s+/g, " ").trim(),
            href: anchor.href,
            context: anchor.closest("li, tr, article, div")?.innerText?.replace(/\s+/g, " ").trim() || "",
          }))
          .filter((item) => item.title.length >= 8)
          .filter((item) => /\/bbs\/|fnView\(/.test(item.href))
          .slice(0, 120);
      })
      .catch(() => []);

    for (const notice of notices) {
      if (!isRequiredNotice(notice.title, notice.context)) continue;
      const date = findDate(notice.context) || findDate(notice.title) || { date: todayIso(), raw: "" };
      collected.push({
        id: stableId(`notice|${notice.href}|${notice.title}`),
        type: "notice",
        title: notice.title.slice(0, 90),
        date: date.date,
        time: "",
        priority: "high",
        note: `${source}: ${notice.context || notice.title}`,
        link: notice.href || url,
        done: false,
      });
    }
  }
}

function isRequiredNotice(title, context) {
  const text = `${title} ${context}`;
  if (!/(수강|과제|출석|시험|평가|기말|형성|학사|계절|등록|신청|강의|장학|졸업)/.test(text)) return false;
  if (/(뉴스|스토리|총동문|홍보|입학|모집|채용|이벤트|보도|협약|대학소개|중앙도서관)/.test(text)) return false;
  return true;
}

async function expandLikelyMenus(page) {
  const keywords = ["수강", "과제", "출석", "학사", "시험", "강의"];
  for (const keyword of keywords) {
    const link = page.getByText(keyword, { exact: false }).first();
    if ((await link.count().catch(() => 0)) === 0) continue;
    await link.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

function parseEventsFromText(text, source, url) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = rawLines.filter((line) => line.length >= 8);

  const events = parseStudyProgress(rawLines, source, url);
  for (const line of lines) {
    if (line.includes("형성평가 기간")) continue;
    if (!/(과제|출석|수강|신청|강의|시험|제출|마감|학사|형성평가|진도율)/.test(line)) continue;
    const date = findDate(line);
    if (!date) continue;
    if (line.includes(`(${date.raw})`)) continue;
    const time = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)?.[0] || "";
    const type = inferType(line);
    const title = line
      .replace(date.raw, " ")
      .replace(time, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);

    events.push({
      id: stableId(`${type}|${date.date}|${time}|${title}`),
      type,
      title: title || `${typeLabel(type)} 일정`,
      date: date.date,
      time,
      priority: type === "assignment" || type === "registration" ? "high" : "normal",
      note: `${source}: ${line}`,
      link: url,
      done: false,
    });
  }
  return events;
}

function parseStudyProgress(lines, source, url) {
  const events = [];
  const periodLine = lines.find((line) => line.includes("형성평가 기간"));
  const periodDates = periodLine ? [...periodLine.matchAll(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g)] : [];
  const dueDate = periodDates.at(-1)?.[0]?.replaceAll(".", "-").replaceAll("/", "-");
  if (!dueDate) return events;

  events.push({
    id: stableId(`formation-period|${dueDate}`),
    type: "course",
    title: "형성평가 기간 마감",
    date: normalizeDate(dueDate),
    time: "23:59",
    priority: "high",
    note: `${source}: ${periodLine}`,
    link: url,
    done: false,
  });

  for (let index = 0; index < lines.length - 2; index += 1) {
    const course = lines[index];
    const status = lines[index + 1];
    const progress = lines[index + 2];
    if (!status.includes("형성평가")) continue;
    if (!/%$/.test(progress)) continue;
    if (isChromeText(course)) continue;

    const percent = Number(progress.replace("%", ""));
    const completed = status.includes("완료") || percent >= 80;
    events.push({
      id: stableId(`course-progress|${course}|${dueDate}`),
      type: "course",
      title: `${course} 형성평가 ${progress}`,
      date: normalizeDate(dueDate),
      time: "23:59",
      priority: completed ? "normal" : "high",
      note: `${source}: ${status} ${progress}`,
      link: url,
      done: completed,
    });
  }

  return events;
}

function isChromeText(value) {
  return /^(본문바로가기|찾기|마이페이지|학습목록|학습현황|수강 강의|내용보기|더보기|새알림|\d+\s*건)$/.test(value);
}

function normalizeDate(value) {
  const match = value.match(/(?<year>20\d{2})[-/.](?<month>\d{1,2})[-/.](?<day>\d{1,2})/);
  if (!match?.groups) return value;
  return `${match.groups.year}-${match.groups.month.padStart(2, "0")}-${match.groups.day.padStart(2, "0")}`;
}

function findDate(value) {
  const currentYear = new Date().getFullYear();
  const patterns = [
    /(?<year>20\d{2})[-/.년\s]+(?<month>\d{1,2})[-/.월\s]+(?<day>\d{1,2})일?/,
    /(?<month>\d{1,2})월\s*(?<day>\d{1,2})일/,
    /(?<month>\d{1,2})\/(?<day>\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match?.groups) continue;
    const year = match.groups.year || String(currentYear);
    const month = match.groups.month;
    const day = match.groups.day;
    return {
      raw: match[0],
      date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    };
  }
  return null;
}

function inferType(value) {
  if (/(수강\s*신청|수강변경|신청기간)/.test(value)) return "registration";
  if (/(출석|강의실|지역대학|화상강의)/.test(value)) return "attendance";
  if (/(강의|수강|진도|학습)/.test(value)) return "course";
  return "assignment";
}

function typeLabel(type) {
  return {
    assignment: "과제물",
    attendance: "출석수업",
    registration: "수강신청",
    course: "수강정보",
    notice: "공지",
  }[type];
}

function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function stableId(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return `knou-${hash.toString(16)}`;
}

function dedupeEvents(events) {
  const map = new Map();
  for (const event of events) {
    const title = event.title.replace(/\s*새글\s*$/, "");
    const key = event.type === "notice" ? `${event.type}|${event.link || title}` : `${event.type}|${event.date}|${event.time}|${title}`;
    map.set(key, { ...event, title });
  }
  return [...map.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
