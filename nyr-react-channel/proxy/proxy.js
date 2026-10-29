"use strict";

// Pengecek link/origin di sisi server.
// Semua endpoint backend WAJIB dibungkus withProxyGuard.

const ALLOWED_HOSTS = [
  "nyr-react-channel-v1.vercel.app"
];

function extractHost(value) {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function isAllowedRequest(req) {
  const originHost = extractHost(req.headers.origin);
  const refererHost = extractHost(req.headers.referer);
  const requestHost = (req.headers.host || "").split(":")[0];
  const candidate = originHost || refererHost || requestHost;
  return ALLOWED_HOSTS.includes(candidate);
}

function withProxyGuard(handler) {
  return async (req, res) => {
    if (!isAllowedRequest(req)) {
      res.status(403).json({ error: "link tidak resmi! Tidak dapat dibuka!" });
      return;
    }
    return handler(req, res);
  };
}

module.exports = { withProxyGuard, isAllowedRequest };
