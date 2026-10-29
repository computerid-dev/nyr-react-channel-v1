"use strict";

// Server lokal untuk tes di Termux: node nyr-react-channel/server.js
// Lalu buka http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");

const reactApi = require("../api/react");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const MAX_BODY = 100 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const BLOCKED_SEGMENTS = new Set(["api", "backend", "proxy", "node_modules"]);
const BLOCKED_FILES = new Set(["ENV-SETUP.txt", "package.json", "vercel.json", "server.js"]);

function decorate(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body terlalu besar"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    res.statusCode = 400;
    res.end("Bad request");
    return;
  }

  if (relative.endsWith("/")) relative += "index.html";

  const filePath = path.normalize(path.join(ROOT, relative));
  const segments = path.relative(ROOT, filePath).split(path.sep);
  const base = path.basename(filePath);

  const outside = !filePath.startsWith(ROOT + path.sep) && filePath !== ROOT;
  const blocked =
    segments.some((part) => BLOCKED_SEGMENTS.has(part) || part.startsWith(".")) ||
    BLOCKED_FILES.has(base);

  if (outside || blocked) {
    res.statusCode = 404;
    res.end("Tidak ditemukan");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.statusCode = 404;
      res.end("Tidak ditemukan");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  decorate(res);
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (pathname === "/api/react") {
    try {
      if (req.method === "POST") {
        const raw = await readBody(req);
        try {
          req.body = raw ? JSON.parse(raw) : {};
        } catch {
          req.body = {};
        }
      }
      await reactApi(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ status: false, message: "Kesalahan server lokal." });
      }
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`NYR React Channel jalan di http://localhost:${PORT}`);
});
