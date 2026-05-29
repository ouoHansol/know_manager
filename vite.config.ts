import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

export default defineConfig({
  base: "./",
  plugins: [react(), knouSyncApi()],
});

function knouSyncApi() {
  return {
    name: "knou-sync-api",
    configureServer(server) {
      server.middlewares.use("/api/sync", async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "POST 요청만 지원합니다." });
          return;
        }

        try {
          const body = JSON.parse((await readBody(request)) || "{}");
          const id = String(body.id || "").trim();
          const password = String(body.password || "");
          const scope = String(body.scope || "profile");

          if (!id || !password) {
            sendJson(response, 400, { error: "아이디와 비밀번호를 입력하세요." });
            return;
          }

          const { collectKnouData } = await import("./scripts/knou-sync.mjs");
          const payload = await collectKnouData({
            id,
            password,
            scope,
            headless: true,
            extraUrls: Array.isArray(body.extraUrls) ? body.extraUrls : [],
          });
          sendJson(response, 200, payload);
        } catch (error) {
          console.error("Local KNOU sync failed", error);
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.",
          });
        }
      });
    },
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
