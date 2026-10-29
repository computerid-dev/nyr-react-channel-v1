"use strict";

/*
  Backend react channel WhatsApp.
  Logika diambil dari plugin index.js (author: nugroho), ditulis ulang
  memakai modul bawaan Node.js (https) supaya tidak perlu npm install.
*/

const https = require("https");

const BASE_URL = (
  process.env.REACT_BASE_URL || "https://satriareact.satriadeveloperz.workers.dev"
).replace(/\/+$/, "");

const ALLOWED_SERVERS = [1, 2, 3];

const LIMITS = {
  maxBatch: 5,          // react per request (menghindari batas waktu Vercel)
  maxEmojis: 10,
  maxEmojiLength: 12,
  maxDelay: 10000,      // ms
  deadlineMs: 50000     // batas aman satu request
};

const CHANNEL_POST_PATTERN =
  /^https:\/\/(www\.)?whatsapp\.com\/channel\/[A-Za-z0-9_-]+\/\d+\/?(\?.*)?$/i;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Content-Type": "application/json",
  "Origin": BASE_URL,
  "Referer": BASE_URL + "/"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function postJson(path, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const target = new URL(BASE_URL + path);

    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname,
        method: "POST",
        headers: { ...BASE_HEADERS, "Content-Length": Buffer.byteLength(body) },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { raw: text.slice(0, 200) };
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("Server react tidak merespons (timeout).")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function handshake(server) {
  const result = await postJson("/api/handshake", { server }, 15000);
  return result.data && typeof result.data === "object" ? result.data : {};
}

function sendReact({ url, emojis, token, authToken, server }) {
  return postJson(
    "/api/react",
    { url, reactions: emojis, token, authToken: authToken || null, server },
    15000
  );
}

function validateInput(body) {
  if (!body || typeof body !== "object") {
    return { error: "Body request tidak valid." };
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!CHANNEL_POST_PATTERN.test(url)) {
    return {
      error: "Link harus link postingan channel, contoh: https://whatsapp.com/channel/xxxx/123"
    };
  }

  const emojis = Array.isArray(body.emojis)
    ? body.emojis.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (emojis.length < 1 || emojis.length > LIMITS.maxEmojis) {
    return { error: `Isi 1 sampai ${LIMITS.maxEmojis} emoji.` };
  }
  if (emojis.some((item) => item.length > LIMITS.maxEmojiLength)) {
    return { error: "Ada emoji yang terlalu panjang." };
  }

  const count = Number.parseInt(body.count, 10);
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.maxBatch) {
    return { error: `Jumlah per kelompok harus 1 sampai ${LIMITS.maxBatch}.` };
  }

  const delay = Number.parseInt(body.delay, 10);
  if (!Number.isInteger(delay) || delay < 0 || delay > LIMITS.maxDelay) {
    return { error: `Jeda harus 0 sampai ${LIMITS.maxDelay} ms.` };
  }

  const server = Number.parseInt(body.server, 10);
  if (!ALLOWED_SERVERS.includes(server)) {
    return { error: "Server harus 1, 2, atau 3." };
  }

  return { value: { url, emojis, count, delay, server } };
}

async function runBatch({ url, emojis, count, delay, server }) {
  const startedAt = Date.now();

  const first = await handshake(server);
  if (!first.success || !first.token) {
    throw new Error(first.error || "Handshake gagal.");
  }

  let token = first.token;
  let authToken = first.authToken || null;
  let success = 0;
  let failed = 0;
  let rehandshakes = 0;

  for (let i = 0; i < count; i++) {
    if (Date.now() - startedAt > LIMITS.deadlineMs) break;

    try {
      const result = await sendReact({
        url,
        emojis: shuffle(emojis),
        token,
        authToken,
        server
      });

      if (result.status === 200 && result.data && result.data.success) {
        success++;
      } else if (result.status === 403 && rehandshakes < 2) {
        rehandshakes++;
        const fresh = await handshake(server);
        if (fresh.success && fresh.token) {
          token = fresh.token;
          authToken = fresh.authToken || null;
          i--; // ulangi react yang tadi ditolak
          continue;
        }
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    if (i < count - 1 && delay > 0) {
      await sleep(delay);
    }
  }

  return { success, failed, attempted: success + failed, rehandshakes };
}

function parseBody(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

async function handleReact(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ status: false, message: "Gunakan method POST." });
    return;
  }

  const checked = validateInput(parseBody(req.body));
  if (checked.error) {
    res.status(400).json({ status: false, message: checked.error });
    return;
  }

  try {
    const data = await runBatch(checked.value);
    res.status(200).json({ status: true, data });
  } catch (error) {
    res.status(502).json({
      status: false,
      message: error && error.message ? error.message : "Gagal menghubungi server react."
    });
  }
}

module.exports = { handleReact, validateInput, LIMITS };
