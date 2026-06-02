# WebM to MP4 Converter

A simple WebM to MP4 converter with a clean browser UI and a fast local Node.js backend powered by native FFmpeg.

## Features

- Drag-and-drop WebM upload
- MP4 output with H.264 video and AAC audio
- Fast native FFmpeg conversion for large files
- Browser FFmpeg fallback for static hosting
- Progress updates and downloadable output

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:4184
```

## Notes On Hosting

The fastest mode uses a native FFmpeg binary from Node.js. Cloudflare Pages and Workers cannot run native binaries at the edge, so Cloudflare Pages can host the browser fallback only.

For large files, deploy the Node server to a platform that supports native binaries and long-running uploads, then optionally put Cloudflare in front of it for DNS, caching, SSL, and access rules.
