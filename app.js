const { FFmpeg } = FFmpegWASM;
const { fetchFile, toBlobURL } = FFmpegUtil;

const dropZone = document.querySelector("#dropZone");
const fileInput = document.querySelector("#fileInput");
const details = document.querySelector("#details");
const preview = document.querySelector("#preview");
const fileName = document.querySelector("#fileName");
const fileMeta = document.querySelector("#fileMeta");
const quality = document.querySelector("#quality");
const mode = document.querySelector("#mode");
const audio = document.querySelector("#audio");
const convertButton = document.querySelector("#convertButton");
const resetButton = document.querySelector("#resetButton");
const downloadLink = document.querySelector("#downloadLink");
const progressPanel = document.querySelector("#progressPanel");
const progressBar = document.querySelector("#progressBar");
const progressText = document.querySelector("#progressText");
const statusText = document.querySelector("#statusText");
const message = document.querySelector("#message");

let ffmpeg;
let selectedFile;
let inputUrl;
let outputUrl;
let isConverting = false;
let nativeAvailable;

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;

const formatBytes = (bytes) => {
  if (!bytes) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const safeOutputName = (name) => {
  const base = name.replace(/\.[^/.]+$/, "") || "converted-video";
  return `${base}.mp4`;
};

const setMessage = (text, isError = false) => {
  message.textContent = text;
  message.classList.toggle("error", isError);
};

const setProgress = (ratio, label = "Converting") => {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  progressPanel.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  statusText.textContent = label;
};

const checkNativeAvailable = async () => {
  if (nativeAvailable !== undefined) return nativeAvailable;

  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    nativeAvailable = response.ok;
  } catch {
    nativeAvailable = false;
  }

  return nativeAvailable;
};

const clearDownload = () => {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = undefined;
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
};

const reset = () => {
  if (inputUrl) URL.revokeObjectURL(inputUrl);
  inputUrl = undefined;
  selectedFile = undefined;
  fileInput.value = "";
  preview.removeAttribute("src");
  details.hidden = true;
  convertButton.disabled = true;
  resetButton.disabled = true;
  progressPanel.hidden = true;
  progressBar.style.width = "0%";
  progressText.textContent = "0%";
  statusText.textContent = "Ready";
  clearDownload();
  setMessage("");
};

const selectFile = (file) => {
  if (!file) return;

  const isWebM = file.type === "video/webm" || file.name.toLowerCase().endsWith(".webm");
  if (!isWebM) {
    setMessage("Please choose a WebM video file.", true);
    return;
  }

  clearDownload();
  if (inputUrl) URL.revokeObjectURL(inputUrl);

  selectedFile = file;
  inputUrl = URL.createObjectURL(file);
  preview.src = inputUrl;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · WebM`;
  details.hidden = false;
  convertButton.disabled = false;
  resetButton.disabled = false;
  progressPanel.hidden = true;
  setMessage(file.size >= LARGE_FILE_THRESHOLD ? "Large file detected. Native FFmpeg mode is recommended." : "Ready to convert.");
};

const loadFFmpeg = async () => {
  if (ffmpeg?.loaded) return ffmpeg;

  ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    if (isConverting) setProgress(progress || 0);
  });
  ffmpeg.on("log", ({ message: logLine }) => {
    if (logLine.includes("Opening")) statusText.textContent = "Preparing video";
  });

  setProgress(0, "Loading FFmpeg");
  setMessage("Loading FFmpeg. This only takes a bit the first time.");

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return ffmpeg;
};

const convert = async () => {
  if (!selectedFile || isConverting) return;

  isConverting = true;
  convertButton.disabled = true;
  resetButton.disabled = true;
  clearDownload();
  setProgress(0, "Preparing video");

  const inputName = "input.webm";
  const outputName = "output.mp4";

  try {
    const useNative = await checkNativeAvailable();
    if (useNative) {
      await convertWithNative();
      return;
    }

    if (selectedFile.size >= LARGE_FILE_THRESHOLD) {
      setMessage("Native FFmpeg server is not running. Browser mode can work, but large files will be much slower.", true);
    }

    const runner = await loadFFmpeg();
    await runner.writeFile(inputName, await fetchFile(selectedFile));

    setProgress(0.02, "Converting");
    await runner.exec([
      "-i",
      inputName,
      "-c:v",
      "libx264",
      "-preset",
      mode.value === "fast" ? "ultrafast" : "medium",
      "-crf",
      quality.value,
      "-c:a",
      "aac",
      "-b:a",
      audio.value,
      "-movflags",
      "faststart",
      outputName,
    ]);

    const data = await runner.readFile(outputName);
    const mp4Blob = new Blob([data.buffer], { type: "video/mp4" });
    outputUrl = URL.createObjectURL(mp4Blob);

    downloadLink.href = outputUrl;
    downloadLink.download = safeOutputName(selectedFile.name);
    downloadLink.hidden = false;
    setProgress(1, "Complete");
    setMessage(`Done. MP4 ready: ${formatBytes(mp4Blob.size)}.`);

    await runner.deleteFile(inputName);
    await runner.deleteFile(outputName);
  } catch (error) {
    console.error(error);
    setMessage(error.message || "Conversion failed. Try a smaller WebM file or a faster speed setting.", true);
    progressPanel.hidden = true;
  } finally {
    isConverting = false;
    convertButton.disabled = !selectedFile;
    resetButton.disabled = !selectedFile;
  }
};

const convertWithNative = async () => {
  const query = new URLSearchParams({
    filename: selectedFile.name,
    mode: mode.value,
    crf: quality.value,
    audio: audio.value,
    preset: mode.value === "fast" ? "ultrafast" : "medium",
  });

  setProgress(0.01, "Uploading");
  setMessage("Using native FFmpeg for faster large-file conversion.");

  const response = await fetch(`/api/convert?${query}`, {
    method: "POST",
    headers: { "content-type": "video/webm" },
    body: selectedFile,
  });

  if (!response.ok || !response.body) {
    throw new Error("Native conversion failed to start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.type === "status") {
        setProgress(event.progress || 0, event.label || "Converting");
      }

      if (event.type === "done") {
        downloadLink.href = event.downloadUrl;
        downloadLink.download = event.filename || safeOutputName(selectedFile.name);
        downloadLink.hidden = false;
        setProgress(1, "Complete");
        setMessage(`Done. MP4 ready: ${formatBytes(event.size)}.`);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
  }
};

fileInput.addEventListener("change", (event) => selectFile(event.target.files?.[0]));
convertButton.addEventListener("click", convert);
resetButton.addEventListener("click", reset);

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  selectFile(event.dataTransfer.files?.[0]);
});

checkNativeAvailable().then((available) => {
  if (available) {
    setMessage("Native FFmpeg mode ready for large files.");
  }
});
