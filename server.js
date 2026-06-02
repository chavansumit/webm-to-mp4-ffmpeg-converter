const { createReadStream, createWriteStream } = require("node:fs");
const fs = require("node:fs/promises");
const { createServer } = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const PORT = Number(process.env.PORT || 4184);
const ROOT = __dirname;
const FFMPEG_PATH = ffmpegInstaller.path || "ffmpeg";
const JOBS = new Map();
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

const sendJson = (res, status, body) => {
  send(res, status, JSON.stringify(body), { "content-type": "application/json; charset=utf-8" });
};

const safeName = (name) => {
  const base = path.basename(name || "converted-video.webm").replace(/[^\w.-]+/g, "-");
  return base.toLowerCase().endsWith(".webm") ? base : `${base}.webm`;
};

const outputNameFor = (name) => `${safeName(name).replace(/\.webm$/i, "")}.mp4`;

const ffmpegArgs = (inputPath, outputPath, query) => {
  const mode = query.get("mode") || "balanced";
  const crf = query.get("crf") || "23";
  const audio = query.get("audio") || "128k";

  if (mode === "fast") {
    return [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "fastdecode",
      "-crf",
      crf,
      "-c:a",
      "aac",
      "-b:a",
      audio,
      "-movflags",
      "+faststart",
      outputPath,
    ];
  }

  return [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-preset",
    query.get("preset") || "medium",
    "-crf",
    crf,
    "-c:a",
    "aac",
    "-b:a",
    audio,
    "-movflags",
    "+faststart",
    outputPath,
  ];
};

const parseTimeSeconds = (line) => {
  const match = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const parseDurationSeconds = (line) => {
  const match = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const hasNativeFFmpeg = () =>
  new Promise((resolve) => {
    const ffmpeg = spawn(FFMPEG_PATH, ["-version"], { stdio: "ignore" });
    ffmpeg.on("error", () => resolve(false));
    ffmpeg.on("close", (code) => resolve(code === 0));
  });

const convertNative = async (req, res, url) => {
  const filename = safeName(url.searchParams.get("filename"));
  const id = randomUUID();
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "webm-to-mp4-"));
  const inputPath = path.join(workDir, filename);
  const outputPath = path.join(workDir, outputNameFor(filename));

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });

  const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`);

  try {
    writeEvent({ type: "status", label: "Uploading", progress: 0.02 });
    await new Promise((resolve, reject) => {
      const stream = createWriteStream(inputPath);
      req.pipe(stream);
      req.on("error", reject);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    writeEvent({ type: "status", label: "Starting FFmpeg", progress: 0.05 });

    await new Promise((resolve, reject) => {
      let duration;
      const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs(inputPath, outputPath, url.searchParams), {
        stdio: ["ignore", "ignore", "pipe"],
      });

      ffmpeg.on("error", reject);
      ffmpeg.stderr.setEncoding("utf8");
      ffmpeg.stderr.on("data", (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          duration ||= parseDurationSeconds(line);
          const current = parseTimeSeconds(line);
          if (duration && current) {
            writeEvent({
              type: "status",
              label: "Converting",
              progress: Math.min(0.98, Math.max(0.06, current / duration)),
            });
          }
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });
    });

    const stat = await fs.stat(outputPath);
    JOBS.set(id, { path: outputPath, name: outputNameFor(filename), workDir, size: stat.size });
    writeEvent({
      type: "done",
      label: "Complete",
      progress: 1,
      downloadUrl: `/api/download/${id}`,
      filename: outputNameFor(filename),
      size: stat.size,
    });
  } catch (error) {
    await fs.rm(workDir, { recursive: true, force: true });
    writeEvent({
      type: "error",
      message:
        error.code === "ENOENT"
          ? "Native FFmpeg is not installed. Install FFmpeg or use browser mode for small files."
          : error.message,
    });
  } finally {
    res.end();
  }
};

const serveDownload = async (req, res, id) => {
  const job = JOBS.get(id);
  if (!job) {
    sendJson(res, 404, { error: "Download expired or missing." });
    return;
  }

  res.writeHead(200, {
    "content-type": "video/mp4",
    "content-length": job.size,
    "content-disposition": `attachment; filename="${job.name}"`,
  });
  createReadStream(job.path).pipe(res);
};

const serveStatic = async (req, res, url) => {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    send(res, 200, file, { "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" });
  } catch {
    send(res, 404, "File not found");
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    const native = await hasNativeFFmpeg();
    sendJson(res, native ? 200 : 503, { native });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/convert") {
    await convertNative(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/download/")) {
    await serveDownload(req, res, url.pathname.split("/").pop());
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res, url);
    return;
  }

  send(res, 405, "Method not allowed");
}).listen(PORT, () => {
  console.log(`WebM to MP4 converter running at http://localhost:${PORT}`);
});
