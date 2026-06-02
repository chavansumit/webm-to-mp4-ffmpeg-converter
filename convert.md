# WebM to MP4 using FFmpeg

## This FFmpeg command converts a .webm video file to a standard .mp4 file using the libx264 codec for video, aac codec for audio, and a CRF value of 22. The preset is set to 'slow' for higher quality encoding, and the audio bitrate is set to 128 kbps.

If the input and output filenames don't contain spaces, quotation marks or other special characters:

```
ffmpeg -i input.webm -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k output.mp4
```

Or escape spaces using backslashes

```
ffmpeg -i input\ with\ spaces.webm -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k output\ with\ spaces.mp4
```

Or use quotation marks in any other cases:

```
ffmpeg -i "input with spaces.webm" -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k "output with spaces.mp4"
```

## Explanation:
-i input.webm: Specifies the input WebM file (use quotes or backslashes for spaces).
-c:v libx264: Uses the libx264 encoder for video (widely compatible).
-preset slow:  Prioritizes quality over speed (consider 'medium' for faster encodes).
-crf 22:  Sets Constant Rate Factor (lower values mean higher quality, typically 18-28 is good).
-c:a aac: Encodes audio with AAC (common and efficient).
-b:a 128k: Sets audio bitrate to 128 kbps (adjust based on needs).
output.mp4:  Names the output MP4 file (use quotes or backslashes for spaces).

## Alternatives & common values:

Video codec alternative to libx264:
- libx265 (for even better compression, but may require more processing power)

Audio codec alternative to AAC and common bitrates:
- libopus (modern, efficient codec) at 64k, 96k, 128k (for music), or even lower for speech-only content
- mp3 (widely supported, but less efficient than AAC or Opus) at 128k, 192k, 256k 

## Potential enhancements:

### 1. Copying metadata:
```
ffmpeg -i "input with spaces.webm" -c:v libx264 -preset slow -crf 22 -c:a aac -b:a 128k -map_metadata 0 "output with spaces.mp4"
```

### 2. Scaling video (if needed):
```
# ffmpeg -i "input with spaces.webm" -vf scale=1280:-2 -c:v libx264 ... 
```

### 3. Hardware acceleration (if available):
```
# ffmpeg -hwaccel auto -i "input with spaces.webm" ... 
```

### 4. Two-pass encoding (for even better quality, but slower):
```
# ffmpeg -i "input with spaces.webm" -c:v libx264 -preset slow -crf 22 -pass 1 -f mp4 /dev/null
# ffmpeg -i "input with spaces.webm" -c:v libx264 -preset slow -crf 22 -pass 2 "output with spaces.mp4"
```

Remember:
- Experiment with CRF and audio bitrate for your specific needs.
- Consider hardware acceleration for faster encodes on supported systems.
- Two-pass encoding offers the best quality but takes longer.
