import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";

const tlsPort = Number(process.env.PORT || "3000");
const appPort = Number(process.env.APP_INTERNAL_PORT || "3001");
const certPath = process.env.TLS_CERT_PATH || "/tmp/talkto-selfsigned.crt";
const keyPath = process.env.TLS_KEY_PATH || "/tmp/talkto-selfsigned.key";

function ensureSelfSignedCert() {
  if (existsSync(certPath) && existsSync(keyPath)) {
    return;
  }

  const subject = process.env.TLS_CERT_SUBJECT || "/CN=localhost";
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-nodes",
      "-days",
      "365",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      subject,
    ],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    throw new Error("Failed to generate self-signed TLS certificate");
  }
}

function startAppServer() {
  const childEnv = {
    ...process.env,
    PORT: String(appPort),
  };

  const child = spawn("node", ["server.js"], {
    env: childEnv,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  return child;
}

function startTlsProxy() {
  const cert = readFileSync(certPath);
  const key = readFileSync(keyPath);

  const server = createHttpsServer({ cert, key }, (req, res) => {
    const upstream = httpRequest(
      {
        hostname: "127.0.0.1",
        port: appPort,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstream.on("error", (error) => {
      console.error("TLS proxy upstream error", error);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Upstream unavailable" }));
    });

    req.pipe(upstream);
  });

  server.on("upgrade", (req, socket) => {
    const upstream = httpRequest({
      hostname: "127.0.0.1",
      port: appPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    });

    upstream.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 ${upstreamRes.statusCode || 101} Switching Protocols\\r\\n` +
          Object.entries(upstreamRes.headers)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
            .join("\\r\\n") +
          "\\r\\n\\r\\n"
      );
      if (upstreamHead?.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });

    upstream.on("error", () => socket.destroy());
    upstream.end();
  });

  server.listen(tlsPort, "0.0.0.0", () => {
    console.log(`TLS proxy listening on https://0.0.0.0:${tlsPort} -> http://127.0.0.1:${appPort}`);
  });

  return server;
}

function main() {
  ensureSelfSignedCert();
  const child = startAppServer();
  const server = startTlsProxy();

  const shutdown = () => {
    server.close(() => {
      if (!child.killed) child.kill("SIGTERM");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
