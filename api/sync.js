import { collectKnouData } from "../scripts/knou-sync.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "POST 요청만 지원합니다." });
    return;
  }

  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    const id = String(body.id || "").trim();
    const password = String(body.password || "");

    if (!id || !password) {
      response.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
      return;
    }

    const payload = await collectKnouData({
      id,
      password,
      headless: true,
      extraUrls: Array.isArray(body.extraUrls) ? body.extraUrls : [],
    });

    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(payload);
  } catch (error) {
    console.error("KNOU sync failed", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.",
    });
  }
}
