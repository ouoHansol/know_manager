import "dotenv/config";
import serverlessChromium from "@sparticuz/chromium";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, "public", "data", "knou-events.json");

const defaultConfig = {
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

let config = defaultConfig;

export async function collectKnouData(options = {}) {
  config = {
    ...defaultConfig,
    ...options,
    extraUrls: Array.isArray(options.extraUrls) ? options.extraUrls : defaultConfig.extraUrls,
    headless: options.headless ?? defaultConfig.headless,
    scope: options.scope || "all",
  };

  if (!config.id || !config.password) {
    throw new Error("KNOU_ID/KNOU_PASSWORD가 없습니다.");
  }

  const browser = await launchBrowser(config.headless);
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();

  const collected = [];
  const errors = [];
  let profile = {};

  try {
    if (config.scope === "all") {
      await openAndMaybeLogin(page, "https://ucampus.knou.ac.kr/ekp/user/login/retrieveULOLogin.do");
      profile = await extractProfile(page);
      await collectFromCurrentPage(page, "U-KNOU", collected);
      await collectNotices(page, "U-KNOU 공지", collected);

      const mobileProfile = await collectMobileKnou(page, collected);
      profile = { ...profile, ...mobileProfile };
      await collectExamApplicationStats(page, collected);

      await openAndMaybeLogin(page, config.startUrl);
      await collectNotices(page, "방통대 공지", collected);

      for (const url of config.extraUrls) {
        await openAndMaybeLogin(page, url);
        await collectFromCurrentPage(page, url, collected);
      }
    } else if (config.scope === "exam") {
      await collectExamApplicationStats(page, collected);
    } else if (config.scope === "notices") {
      await collectNotices(page, "방통대 공지", collected, { includeDetail: false, maxItems: 10 });
    } else {
      const mobileProfile = await collectMobileKnou(page, collected, config.scope);
      profile = { ...profile, ...mobileProfile };
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
  }

  const events = dedupeEvents(collected);
  profile = normalizeProfile(profile);
  return {
    syncedAt: new Date().toISOString(),
    source: "knou-playwright",
    errors,
    events,
    profile,
  };
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return {};
  const hasMeaningfulProfile = Boolean(profile.name || profile.department || profile.credits || profile.grade);
  if (hasMeaningfulProfile) return profile;
  return {};
}

async function getBrowserLaunchOptions(headless) {
  if (!process.env.VERCEL && !process.env.AWS_REGION) {
    return { headless };
  }

  return {
    args: serverlessChromium.args,
    executablePath: await serverlessChromium.executablePath(),
    headless: true,
  };
}

async function launchBrowser(headless) {
  const launchOptions = await getBrowserLaunchOptions(headless);
  let lastError;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await chromium.launch(launchOptions);
    } catch (error) {
      lastError = error;
      if (!isTemporaryLaunchError(error) || attempt === 4) break;
      await wait(700 * (attempt + 1));
    }
  }

  throw lastError;
}

function isTemporaryLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /ETXTBSY|Text file busy|spawn .*chromium/i.test(message);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safePageWait(page, ms) {
  try {
    await page.waitForTimeout(ms);
  } catch (error) {
    if (!isClosedPageError(error)) throw error;
  }
}

function isClosedPageError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|Execution context was destroyed/i.test(message);
}

async function runCliSync() {
  try {
    const payload = await collectKnouData();
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`수집 완료: ${payload.events.length}개 -> ${outputPath}`);
    if (payload.errors.length) {
      console.log(`주의: ${payload.errors.join(" | ")}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCliSync();
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

async function collectNotices(page, source, collected, options = {}) {
  const includeDetail = options.includeDetail ?? true;
  const maxItems = options.maxItems || 20;
  const noticeUrls = [
    "https://www.knou.ac.kr/knou/561/subview.do",
    "https://www.knou.ac.kr/knou/47/subview.do",
    "https://ucampus.knou.ac.kr/ekp/user/notice/initUBDNotice.do",
  ];

  for (const url of noticeUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
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
          .slice(0, 50);
      })
      .catch(() => []);

    for (const notice of notices) {
      if (!isRequiredNotice(notice.title, notice.context)) continue;
      if (collected.filter((event) => event.type === "notice").length >= maxItems) return;
      const date = findDate(notice.context) || findDate(notice.title) || { date: todayIso(), raw: "" };
      const detail = includeDetail ? await fetchNoticeDetail(page, notice.href) : "";
      collected.push({
        id: stableId(`notice|${notice.href}|${notice.title}`),
        type: "notice",
        title: notice.title.slice(0, 90),
        date: date.date,
        time: "",
        priority: "high",
        note: `${source}: ${notice.context || notice.title}`,
        summary: summarizeNoticeDetail(`${notice.title}\n${notice.context}\n${detail}`),
        link: notice.href || url,
        done: false,
      });
    }
  }
}

async function collectMobileKnou(page, collected, scope = "mobile") {
  const allTargets = [
    ["https://m.knou.ac.kr/", "MyKNOU"],
    ["https://m.knou.ac.kr/assignment/submit", "과제 제출"],
    ["https://m.knou.ac.kr/assignment/class-attendance", "출석수업과제 제출"],
    ["https://m.knou.ac.kr/attendance/schedule-place-inquiry", "출석수업 시간표"],
    ["https://m.knou.ac.kr/attendance/change-type", "출석수업 유형 변경"],
    ["https://m.knou.ac.kr/ale/substitute-application", "대체이수 신청"],
    ["https://m.knou.ac.kr/arc", "성적"],
    ["https://m.knou.ac.kr/agm", "졸업/학점"],
    ["https://m.knou.ac.kr/asm/academic-record", "학적 조회"],
    ["https://m.knou.ac.kr/dashboard/course-list", "수강목록"],
  ];
  const scopeMap = {
    profile: ["/", "/agm", "/dashboard/course-list"],
    assignments: ["/assignment/submit", "/assignment/class-attendance"],
    attendance: ["/attendance/schedule-place-inquiry", "/attendance/change-type", "/ale/substitute-application"],
    grades: ["/arc", "/agm", "/asm/academic-record"],
    courses: ["/", "/dashboard/course-list"],
    mobile: ["/", "/assignment/submit", "/assignment/class-attendance", "/attendance/schedule-place-inquiry"],
  };
  const allowedPaths = scopeMap[scope] || scopeMap.mobile;
  const targets = allTargets.filter(([url]) => allowedPaths.includes(new URL(url).pathname));
  let profile = {};

  for (const [url, source] of targets) {
    const opened = await safeOpenMobilePage(page, url);
    if (!opened) continue;
    const data = await extractMobilePageData(page);
    profile = { ...profile, ...extractMobileProfile(data.text) };
    if (url.includes("/dashboard/course-list")) {
      profile.courseListUrl = url;
    }
    if (url.includes("/agm")) {
      profile.creditUrl = url;
    }

    if (url.includes("/assignment/submit")) {
      collected.push(...parseMobileAssignmentCards(data.assignmentCards, "assignment", "중간 과제물", source, url));
    } else if (url.includes("/assignment/class-attendance")) {
      collected.push(...parseMobileAssignmentCards(data.assignmentCards, "substitute", "출석수업 과제물", source, url));
    } else if (url.includes("/attendance/schedule-place-inquiry")) {
      collected.push(...parseMobileAttendance(data.text, source, url));
    } else if (url.includes("/attendance/change-type")) {
      collected.push(...parseUnavailableNotice(data.text, "attendance", "출석수업 유형 변경", source, url));
    } else if (url.includes("/ale/substitute-application")) {
      collected.push(...parseUnavailableNotice(data.text, "substitute", "대체이수 신청", source, url));
    } else if (url.includes("/arc")) {
      collected.push(...parseMobileGrades(data.text, source, url));
    } else if (url.includes("/agm")) {
      profile = { ...profile, ...extractGraduationProfile(data.text) };
    } else if (url === "https://m.knou.ac.kr/") {
      collected.push(...parseMobileCourseList(data.text, source, url));
    } else if (url.includes("/dashboard/course-list")) {
      collected.push(...parseMobileCourseList(data.text, source, url));
    }
  }

  return profile;
}

async function safeOpenMobilePage(page, url) {
  try {
    await openAndMaybeLogin(page, url);
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    await safePageWait(page, 500);
    return true;
  } catch {
    return false;
  }
}

async function extractMobilePageData(page) {
  await page.locator("body").waitFor({ timeout: 5000 }).catch(() => {});
  return await page
    .evaluate(() => ({
      text: document.body?.innerText || "",
      assignmentCards: [...document.querySelectorAll(".knou_assignment_card")].map((card) => ({
        text: card.innerText || "",
        activeStatus: card.querySelector(".knou_stage_progress_status.active")?.innerText?.trim() || "",
        link: card.querySelector("a")?.href || location.href,
      })),
    }))
    .catch(() => ({ text: "", assignmentCards: [] }));
}

function extractMobileProfile(text) {
  const profile = {};
  const name = text.match(/([가-힣]{2,5})\s*학우님/)?.[1] || text.match(/성명\s*\n\s*([^\n]+)/)?.[1]?.trim();
  const department = text.match(/계정 설정\s*\n\s*([^\n|]+학과)/)?.[1]?.trim() || text.match(/학과\s*\n\s*([^\n]+)/)?.[1]?.trim();
  if (name) profile.name = name;
  if (department) profile.department = department;
  const credits = text.match(/(취득학점|총학점|이수학점)\s*\n?\s*([0-9.]+\s*학점?)/)?.[2]?.trim();
  if (credits) profile.credits = credits;
  const grade = text.match(/(평점평균|총평점|평균평점)\s*\n?\s*([0-9.]+)/)?.[2]?.trim();
  if (grade) profile.grade = grade;
  return profile;
}

function extractGraduationProfile(text) {
  const lines = normalizeLines(text);
  const profile = {};
  const creditIndex = lines.findIndex((line) => line === "취득학점");
  if (creditIndex >= 0) {
    const totalLine = lines.slice(creditIndex + 1, creditIndex + 5).find((line) => /총\s*\d+학점/.test(line));
    if (totalLine) profile.credits = totalLine.replace(/\s+/g, " ");
  }
  const avgIndex = lines.findIndex((line) => /평점평균/.test(line));
  if (avgIndex >= 0) {
    profile.grade = lines[avgIndex].replace(/\s+/g, " ");
  }
  const conversionIndex = lines.findIndex((line) => /백점환산/.test(line));
  if (conversionIndex >= 0) {
    profile.grade = [profile.grade, lines[conversionIndex].replace(/\s+/g, " ")].filter(Boolean).join(" / ");
  }
  return profile;
}

function parseMobileAssignmentCards(cards, type, label, source, url) {
  return cards
    .map((card) => {
      const lines = normalizeLines(card.text);
      const receiptIndex = lines.findIndex((line) => line === "접수번호");
      const course = lines[receiptIndex + 2] || lines.find((line) => isCourseLike(line)) || label;
      const periodLine = lines.find((line) => /20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*~/.test(line)) || "";
      const dates = [...periodLine.matchAll(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g)].map((match) => normalizeDate(match[0]));
      const dueDate = dates.at(-1);
      if (!dueDate) return null;
      const status = statusFromActiveStage(card.activeStatus, dueDate);
      const time = periodLine.match(/~\s*([01]?\d|2[0-3]):([0-5]\d)/)?.[0]?.replace("~", "").trim() || "23:59";
      return {
        id: stableId(`mobile-assignment|${type}|${course}|${dueDate}|${label}`),
        type,
        title: `${course} ${label}`,
        date: dueDate,
        time,
        priority: status === "missed" ? "high" : "normal",
        note: `${source}: 현재상태 ${card.activeStatus || "확인필요"} / ${periodLine}`,
        link: card.link || url,
        status,
        done: ["submitted", "graded", "complete"].includes(status),
      };
    })
    .filter(Boolean);
}

function statusFromActiveStage(activeStatus, dueDate) {
  if (/평가완료/.test(activeStatus)) return "graded";
  if (/제출완료|평가중/.test(activeStatus)) return "submitted";
  if (/미제출/.test(activeStatus) && new Date(`${dueDate}T23:59:59`) < new Date()) return "missed";
  if (/미제출/.test(activeStatus)) return "open";
  return inferStatus(activeStatus || "", dueDate);
}

function parseMobileAttendance(text, source, url) {
  const lines = normalizeLines(text);
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^수업 일시/.test(lines[index])) continue;
    const date = findDate(lines[index]);
    if (!date) continue;
    const course = findPreviousCourseName(lines, index);
    const place = lines.slice(index + 1, index + 5).find((line) => /^장소 및 강의실/.test(line)) || "";
    const professor = lines.slice(index + 1, index + 6).find((line) => /^담당교수/.test(line)) || "";
    const isPast = new Date(`${date.date}T23:59:59`) < new Date();
    events.push({
      id: stableId(`mobile-attendance|${course}|${date.date}`),
      type: "attendance",
      title: `${course} 출석수업`,
      date: date.date,
      time: lines[index].match(/\(([0-2]?\d:[0-5]\d)/)?.[1] || "",
      priority: isPast ? "normal" : "high",
      note: `${source}: ${lines[index]} ${place} ${professor}`.trim(),
      link: url,
      status: isPast ? "complete" : "open",
      done: isPast,
    });
  }
  return events;
}

function parseUnavailableNotice(text, type, title, source, url) {
  if (!/기간이 아닙니다|업무처리기간이 아닙니다/.test(text)) return [];
  return [
    {
      id: stableId(`mobile-unavailable|${type}|${title}|${todayIso()}`),
      type,
      title,
      date: todayIso(),
      time: "",
      priority: "normal",
      note: `${source}: 현재 신청/변경 기간이 아닙니다.`,
      link: url,
      status: "complete",
      done: true,
    },
  ];
}

function parseMobileGrades(text, source, url) {
  const lines = normalizeLines(text);
  const yearTerm = lines.find((line) => /20\d{2}학년도\s+\d학기/.test(line)) || "";
  return unique(lines.filter((line) => isCourseLike(line)))
    .map((course) => {
      const courseIndex = lines.findIndex((line) => line === course);
      const block = lines.slice(courseIndex, courseIndex + 8).join(" ");
      const score = block.match(/(?:점수|취득점수|평점|등급)\s*[:：]?\s*([A-F][+0-]?|\d{1,3}(?:\.\d+)?점?)/i)?.[1] || "";
      if (!score) return null;
      return {
        id: stableId(`mobile-grade|${course}|${yearTerm}|${score}`),
        type: "grade",
        title: `${course} 성적`,
        date: "",
        time: "",
        priority: "normal",
        note: `${source}: ${yearTerm || "현재학기"} 성적 ${score}`,
        link: url,
        status: "graded",
        done: true,
      };
    })
    .filter(Boolean);
}

function parseMobileCourseList(text, source, url) {
  const lines = normalizeLines(text);
  return parseStudyProgress(lines, source, url);
}

async function collectExamApplicationStats(page, collected) {
  const url = "https://applyibt.knou.ac.kr/examneApplicationStats/index.do";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await loginApplyIbtIfNeeded(page);
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await safePageWait(page, 1000);

  const scheduleButton = page.getByText(/시험\s*일정\s*확인|일정\s*확인/).first();
  if ((await scheduleButton.count().catch(() => 0)) > 0) {
    await scheduleButton.click({ timeout: 5000 }).catch(() => {});
    await safePageWait(page, 1200);
  }

  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const events = parseApplyIbtExamSchedule(text, page.url());
  collected.push(...events);
}

async function loginApplyIbtIfNeeded(page) {
  const idInput = page.locator("#logInId, input[name='logInId'], input[type='text']").first();
  const passwordInput = page.locator("input[name='pwd'], input[type='password']").first();
  if ((await idInput.count().catch(() => 0)) === 0 || (await passwordInput.count().catch(() => 0)) === 0) return;
  const visible = await passwordInput.isVisible().catch(() => false);
  if (!visible) return;
  await idInput.fill(config.id);
  await passwordInput.fill(config.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
    passwordInput.press("Enter"),
  ]);
}

function parseApplyIbtExamSchedule(text, url) {
  const normalized = text.replace(/\r/g, "");
  const genericEvents = parseGenericApplyIbtExamSchedule(normalized, url);
  if (genericEvents.length) return genericEvents;

  const detailIndex = normalized.indexOf("시험신청 상세내용");
  const applicationStatus = normalized.match(/대상\s*과목\s*:\s*(\d+)과목\s*중\s*(\d+)과목\s*신청/);
  const period = normalized.match(/시험신청기간\s*:\s*(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*~\s*(20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2})/);

  if (detailIndex < 0) {
    const endDate = period?.[2]?.slice(0, 10) || "";
    return [
      {
        id: stableId(`applyibt-need-selection|${endDate || todayIso()}`),
        type: "exam",
        title: "기말시험 일자 선택 필요!",
        date: endDate,
        time: period?.[2]?.slice(11) || "",
        priority: "high",
        note: `*시험일자 선택 필요! 시험신청현황에서 시험일자와 시험장을 선택하세요.${applicationStatus ? ` (${applicationStatus[2]}/${applicationStatus[1]}과목 신청)` : ""}`,
        link: url,
        status: "available",
        done: false,
      },
    ];
  }

  const detail = normalized.slice(detailIndex);
  const blocks = [...detail.matchAll(/(?:^|\n)\s*(\d+)\s*시험장\s*([^\n]+?)(?:\s*지도보기)?\s*\n시험일\s*(20\d{2}-\d{2}-\d{2})[^\n]*\n차시\s*([^\n]+)\n시험시간\s*([^\n]+)\n응시과목\s*([\s\S]*?)(?=\n\s*\d+\s*시험장|\n\s*목록|\n\s*공석조회|$)/g)];

  if (!blocks.length) {
    const endDate = period?.[2]?.slice(0, 10) || "";
    return [
      {
        id: stableId(`applyibt-unparsed|${endDate || todayIso()}`),
        type: "exam",
        title: "기말시험 일자 확인 필요!",
        date: endDate,
        time: period?.[2]?.slice(11) || "",
        priority: "high",
        note: "*시험일자 확인 필요! 시험신청현황에 신청 내역은 있으나 상세 일자/장소를 자동 파싱하지 못했습니다.",
        link: url,
        status: "available",
        done: false,
      },
    ];
  }

  return blocks.map((match) => {
    const round = match[1].trim();
    const place = match[2].replace(/\s*지도보기\s*$/, "").trim();
    const date = match[3].trim();
    const roundLabel = match[4].replace(/\s*\[.*$/, "").trim();
    const examTime = match[5].replace(/\s*※.*$/, "").trim();
    const subjects = match[6]
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split("_").at(-1) || line)
      .join(", ");
    const startTime = examTime.match(/\b([0-2]?\d:[0-5]\d)\b/)?.[1] || "";

    return {
      id: stableId(`applyibt-exam|${date}|${roundLabel}|${place}|${subjects}`),
      type: "exam",
      title: `기말시험 ${roundLabel || `${round}차시`}`,
      date,
      time: startTime,
      priority: "high",
      note: `*시험일자 ${date} / ${place} / ${examTime}${subjects ? ` / 응시과목: ${subjects}` : ""}`,
      link: url,
      status: "open",
      done: false,
    };
  });
}

function parseGenericApplyIbtExamSchedule(text, url) {
  const blocks = splitExamBlocks(normalizeLines(text));
  const events = [];

  for (const block of blocks) {
    const joined = block.join("\n");
    const date = joined.match(/20\d{2}-\d{2}-\d{2}/)?.[0];
    const timeRange = joined.match(/(?:[01]?\d|2[0-3]):[0-5]\d\s*~\s*(?:[01]?\d|2[0-3]):[0-5]\d/)?.[0];
    if (!date || !timeRange) continue;

    const place =
      block.find((line) => /(지역대학|학습관|시험장|캠퍼스|온라인|ZOOM)/.test(line) && !/응시과목|시험시간|시험일자/.test(line)) ||
      block.find((line) => /(지역|학습관)/.test(line)) ||
      "";
    const roundLabel = joined.match(/(\d+)\s*차시/)?.[0] || `${events.length + 1}차시`;
    const subjects = extractExamSubjects(block);
    if (!subjects.length && !place) continue;

    events.push({
      id: stableId(`applyibt-selected|${date}|${timeRange}|${subjects.join(",") || roundLabel}`),
      type: "exam",
      title: `기말시험 ${roundLabel}`,
      date,
      time: timeRange.split("~")[0].trim(),
      priority: "high",
      note: `*시험일자 ${date} / ${place || "시험장 확인 필요"} / ${timeRange}${subjects.length ? ` / 응시과목: ${subjects.join(", ")}` : ""}`,
      link: url,
      status: "open",
      done: false,
    });
  }

  return events;
}

function splitExamBlocks(lines) {
  const blocks = [];
  let current = [];

  for (const line of lines) {
    const startsBlock = /(?:^|\s)\d+\s*차시|(?:^|\s)\d+\s*시험/.test(line);
    if (startsBlock && current.length) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks.filter((block) => block.some((line) => /20\d{2}-\d{2}-\d{2}/.test(line) || /응시과목/.test(line)));
}

function extractExamSubjects(lines) {
  const subjects = [];
  const subjectIndex = lines.findIndex((line) => /응시과목/.test(line));
  const sourceLines = subjectIndex >= 0 ? lines.slice(subjectIndex) : lines;

  for (const line of sourceLines) {
    const cleaned = line
      .replace(/^응시과목\s*:?\s*/, "")
      .replace(/^\d+\s*/, "")
      .trim();
    if (!cleaned || /응시과목|목록|공석|조회|시험일자|시험시간|차시|지역대학|학습관/.test(cleaned)) continue;
    if (isCourseLike(cleaned) && !subjects.includes(cleaned)) subjects.push(cleaned);
  }

  return subjects.slice(0, 8);
}

async function extractProfile(page) {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const departmentIndex = lines.findIndex((line) => /학과|학부|전공/.test(line));
  return {
    name: departmentIndex > 0 ? lines[departmentIndex - 1] : "",
    department: departmentIndex >= 0 ? lines[departmentIndex] : "",
    credits: "",
    grade: "",
  };
}

async function fetchNoticeDetail(page, href) {
  if (!href || href.startsWith("javascript:")) return "";
  const detailPage = await page.context().newPage();
  try {
    await detailPage.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await detailPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    return await detailPage.evaluate(() => {
      const meta = document.querySelector("meta[name='description']")?.getAttribute("content") || "";
      const template = document.createElement("template");
      template.innerHTML = meta;
      const metaText = template.content.textContent || "";
      const bodyText = document.body?.innerText || "";
      return `${metaText}\n${bodyText}`.replace(/\s+/g, " ").trim();
    });
  } catch {
    return "";
  } finally {
    await detailPage.close().catch(() => {});
  }
}

function summarizeNoticeDetail(text) {
  const normalized = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [
    ["핵심", /(수강료|납부|제출|신청|출석|시험|성적|학점|계절수업)[^。.!?\n]{0,120}/g],
    ["기간", /(기간|일시|날짜|신청기간|납부기간|제출기간)[^。.!?\n]{0,140}/g],
    ["금액", /(수강료|금액|원|납부액)[^。.!?\n]{0,120}/g],
    ["대상", /(대상|납부대상자|신청대상자)[^。.!?\n]{0,120}/g],
    ["방법", /(방법|메뉴|경로|등록|계좌|납부방법)[^。.!?\n]{0,140}/g],
  ];
  const summary = [];
  const seen = new Set();

  for (const [label, pattern] of candidates) {
    for (const match of normalized.matchAll(pattern)) {
      const value = match[0].replace(/[✓□○※]+/g, "").trim();
      if (value.length < 8 || seen.has(value)) continue;
      seen.add(value);
      summary.push({ label, text: value.slice(0, 170) });
      break;
    }
  }

  if (!summary.length && normalized) {
    summary.push({ label: "요약", text: normalized.slice(0, 180) });
  }

  return summary.slice(0, 5);
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
    await safePageWait(page, 300);
  }
}

function parseEventsFromText(text, source, url) {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines = rawLines.filter((line) => line.length >= 8);

  const events = parseStudyProgress(rawLines, source, url);
  events.push(...parseStatusRows(rawLines, source, url));
  for (const line of lines) {
    if (line.includes("형성평가 기간")) continue;
    if (!/(과제|출석|수강|신청|강의|시험|제출|마감|학사|형성평가|진도율)/.test(line)) continue;
    const date = findDate(line);
    if (!date) continue;
    if (line.includes(`(${date.raw})`)) continue;
    const time = line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)?.[0] || "";
    const type = inferType(line);
    const status = inferStatus(line, date.date);
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
      status,
      done: ["submitted", "graded", "complete"].includes(status),
    });
  }
  return events;
}

function parseStatusRows(lines, source, url) {
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("형성평가 기간") || /^(형성평가 안내|내용보기|더보기)$/.test(line)) continue;
    if (!/(과제|출석|대체|성적|학점|평가|제출|미제출|기간초과|결석)/.test(line)) continue;

    const date = findDate(line) || findNearbyDate(lines, index);
    if (!date) continue;
    const type = inferType(line);
    const status = inferStatus(line, date.date);
    if (status === "open" && !/(성적|학점|출석|대체)/.test(line)) continue;

    events.push({
      id: stableId(`status-row|${type}|${date.date}|${line}`),
      type,
      title: cleanupTitle(line, date.raw, type),
      date: date.date,
      time: line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)?.[0] || "",
      priority: status === "missed" ? "high" : "normal",
      note: `${source}: ${line}`,
      link: url,
      status,
      done: ["submitted", "graded", "complete"].includes(status),
    });
  }
  return events;
}

function findNearbyDate(lines, index) {
  for (let offset = 1; offset <= 2; offset += 1) {
    const before = lines[index - offset] ? findDate(lines[index - offset]) : null;
    if (before) return before;
    const after = lines[index + offset] ? findDate(lines[index + offset]) : null;
    if (after) return after;
  }
  return null;
}

function cleanupTitle(line, rawDate, type) {
  return (
    line
      .replace(rawDate || "", " ")
      .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90) || `${typeLabel(type)} 상태`
  );
}

function parseStudyProgress(lines, source, url) {
  const events = [];
  const periodLine = lines.find((line) => /형성평가\s*기간|뺤꽦.?됯?.?湲곌컙/.test(line));
  const periodDates = periodLine ? [...periodLine.matchAll(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g)] : [];
  const dashboardPeriodLine = lines.find((line) => /20\d{2}[./-]\d{1,2}[./-]\d{1,2}\.?\s*[-~]\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}/.test(line));
  const dashboardPeriodDates = dashboardPeriodLine ? [...dashboardPeriodLine.matchAll(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g)] : [];
  const dueDate = periodDates.at(-1)?.[0]?.replaceAll(".", "-").replaceAll("/", "-") || dashboardPeriodDates.at(-1)?.[0]?.replaceAll(".", "-").replaceAll("/", "-");
  if (!dueDate) return events;

  events.push({
    id: stableId(`formation-period|${dueDate}`),
    type: "course",
    title: "형성평가 기간 마감",
    date: normalizeDate(dueDate),
    time: "23:59",
    priority: "high",
    note: `${source}: ${periodLine || `형성평가 기간: ${dashboardPeriodLine}`}`,
    link: url,
    done: false,
  });

  const dashboardProgress = lines.find((line) => /^\d{1,3}%$/.test(line));
  const dashboardCourseLine = lines.find((line) => line.includes(",") && line.split(",").filter((part) => isCourseLike(part.trim())).length >= 2);
  if (dashboardProgress && dashboardCourseLine) {
    const percent = Number(dashboardProgress.replace("%", ""));
    const completed = percent >= 80;
    return [
      ...events,
      ...dashboardCourseLine
        .split(",")
        .map((course) => course.trim())
        .filter(isCourseLike)
        .map((course) => ({
          id: stableId(`course-progress|${course}|${dueDate}`),
          type: "course",
          title: `${course} 형성평가 ${dashboardProgress}`,
          date: normalizeDate(dueDate),
          time: "23:59",
          priority: completed ? "normal" : "high",
          note: `${source}: 형성평가 진도율 ${dashboardProgress}`,
          link: url,
          done: completed,
        })),
    ];
  }

  for (let index = 0; index < lines.length - 2; index += 1) {
    const course = lines[index];
    const status = lines[index + 1];
    const progress = lines[index + 2];
    if (!/형성평가|뺤꽦.?됯?/.test(status)) continue;
    if (!/%$/.test(progress)) continue;
    if (isChromeText(course)) continue;

    const percent = Number(progress.replace("%", ""));
    const completed = /완료|꾨즺/.test(status) || percent >= 80;
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

function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function isCourseLike(value) {
  if (!value || value.length > 30) return false;
  if (isChromeText(value)) return false;
  if (/(MyKNOU|과제물|성적|수강목록|출석수업|현재학기|조회|연도|학기|공지|시험|제출|신청|장소|유형|평가|학점|등록|메뉴|바로가기|학우님|컴퓨터과학과)/.test(value)) {
    return false;
  }
  if (/\d학년|\d{3,}/.test(value)) return false;
  return /(컴퓨터의이해|파이썬프로그래밍기초|데이터정보처리입문|테마가있는음악여행|환경과건강|생활과건강|기초$|입문$|여행$|건강$|이해$)/.test(value);
}

function findPreviousCourseName(lines, index) {
  for (let cursor = index - 1; cursor >= Math.max(0, index - 8); cursor -= 1) {
    if (isCourseLike(lines[cursor])) return lines[cursor];
  }
  return "출석수업";
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
  if (/(출석\s*대체|대체\s*과제|대체시험|대체\s*신청)/.test(value)) return "substitute";
  if (/(중간시험|기말시험|중간평가|기말평가|시험)/.test(value)) return "exam";
  if (/(성적|학점|평점|취득학점|이수학점)/.test(value)) return "grade";
  if (/(출석|강의실|지역대학|화상강의)/.test(value)) return "attendance";
  if (/(강의|수강|진도|학습)/.test(value)) return "course";
  return "assignment";
}

function inferStatus(value, date) {
  if (/(평가완료|채점완료|성적확정|성적완료)/.test(value)) return "graded";
  if (/(제출완료|신청완료|완료|이수|출석완료)/.test(value)) return "submitted";
  if (/(미제출|기간초과|기한초과|제출불가|결석|미응시|불참|마감)/.test(value)) return "missed";
  if (/(신청가능|제출가능|접수중)/.test(value)) return "available";
  if (date && new Date(`${date}T23:59:59`) < new Date()) return "missed";
  return "open";
}

function typeLabel(type) {
  return {
    assignment: "과제물",
    attendance: "출석수업",
    registration: "수강신청",
    course: "수강정보",
    substitute: "출석대체",
    grade: "학점",
    exam: "시험",
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
