// 免费托管用的出口转发：/<RELAY_TOKEN>/v1/* -> https://aiverge.eu.cc/v1/*
// 无第三方依赖；请求体和 SSE 响应都按流透传。

const http = require("http");
const https = require("https");

const UPSTREAM = new URL(process.env.UPSTREAM || "https://aiverge.eu.cc");
const TOKEN = process.env.RELAY_TOKEN || "";
const PORT = Number(process.env.PORT || 10000);

const agent = new https.Agent({ keepAlive: true });
const DROP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length",
  "x-forwarded-for", "x-forwarded-proto", "x-real-ip",
]);

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

function copyHeaders(source, dropLength) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const name = key.toLowerCase();
    if (DROP.has(name)) continue;
    if (dropLength && name === "content-length") continue;
    out[key] = value;
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const prefix = "/" + TOKEN;

  if (!TOKEN || !url.pathname.startsWith(prefix + "/")) return notFound(res);

  const path = url.pathname.slice(prefix.length);
  if (path === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (!path.startsWith("/v1/")) return notFound(res);

  const upstreamReq = https.request(
    {
      hostname: UPSTREAM.hostname,
      port: UPSTREAM.port || 443,
      path: path + url.search,
      method: req.method,
      headers: { ...copyHeaders(req.headers, false), host: UPSTREAM.host },
      agent,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, copyHeaders(upstreamRes.headers, true));
      upstreamRes.pipe(res);
      upstreamRes.on("error", () => res.destroy());
    }
  );

  upstreamReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "relay upstream failed" } }));
    } else {
      res.destroy();
    }
  });

  req.pipe(upstreamReq);
  res.on("close", () => upstreamReq.destroy());
});

server.listen(PORT, () => {
  console.log("relay listening on " + PORT);
});
