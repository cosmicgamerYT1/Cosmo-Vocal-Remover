# Vocal Remover

A premium, browser-based AI vocal remover. Upload a song or a video, and it
separates **vocals** and **instrumental** tracks — entirely on your own
device. No file ever leaves your browser, there's no backend to pay for, and
it deploys to Vercel with a single `git push`.

**Upload → Separate → Preview → Download.**

---

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Technology stack](#technology-stack)
- [How the separation works](#how-the-separation-works)
- [How video processing works](#how-video-processing-works)
- [Bring your own model (required setup step)](#bring-your-own-model-required-setup-step)
- [Running locally](#running-locally)
- [Building](#building)
- [Deploying to Vercel](#deploying-to-vercel)
- [Environment variables](#environment-variables)
- [Browser requirements](#browser-requirements)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

---

## What it does

Drop in an audio or video file and the app splits it into two stems:

- **Vocals** — the isolated singing/speech
- **Instrumental** — everything else (drums, bass, music), i.e. a
  "vocal-removed" version

### Audio features

- Supports MP3, WAV, FLAC, M4A, AAC, OGG, WebM input
- Outputs both stems as high-quality 16-bit PCM WAV files
- Custom waveform player for each stem — play/pause, seek, volume, speed,
  independent download buttons, plus a combined "Download Both"

### Video features

- Supports MP4, MKV (and MOV/WebM) input
- Extracts the audio track, separates it, and re-muxes the **original video
  stream** with the new instrumental audio into a real MP4 container
  (never a renamed MKV)
- Preserves original resolution, frame rate, and (whenever the source codec
  is MP4-compatible) the original video stream bit-for-bit via stream copy
- Falls back to a high-quality H.264 re-encode only when the source codec
  can't legally live inside an MP4 container
- Also lets you download the extracted vocals/instrumental as standalone
  audio files

### Everything else

- Fully client-side processing — your media never touches a server
- WebGPU acceleration with automatic WASM fallback
- Model is downloaded once and cached in IndexedDB for instant reuse
- Responsive, accessible, dark, glass-morphic UI
- Honest progress indicators (no fake percentages) and clear error states

---

## Technology stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) + React 18 + TypeScript | Zero-config Vercel deploys, static-friendly |
| Styling | Tailwind CSS | Fast to build a consistent, polished design system |
| ML inference | [onnxruntime-web](https://github.com/microsoft/onnxruntime) | Runs ONNX models in-browser via WebGPU/WASM, no server needed |
| Audio decode/encode | Web Audio API + a hand-rolled WAV encoder | Zero dependencies, works for every browser-decodable codec |
| STFT / signal processing | Custom FFT + STFT/ISTFT (`lib/fft.ts`, `lib/stft.ts`) | No black box — a small, auditable, dependency-free implementation |
| Video muxing | [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) (single-threaded core) | Real MP4 container generation without a native FFmpeg install, and without requiring COOP/COEP headers |
| Model caching | [idb-keyval](https://github.com/jakearchibald/idb-keyval) | Minimal IndexedDB wrapper for caching the downloaded model |

No dependency here is decorative — each one is load-bearing for a feature
described above.

---

## How the separation works

This is genuine machine-learning source separation, run in an STFT
(spectrogram) domain — the same family of approach used by tools like
Spleeter, Demucs, and MDX-Net. Specifically, the app is wired to the tensor
contract used by real **UVR-MDX-Net** ONNX models (the format produced by
the widely-used, open-source
[python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
/ Ultimate Vocal Remover project):

1. The stereo mix is split into ~6-second chunks. Each channel of each
   chunk is transformed into a spectrogram via a **Short-Time Fourier
   Transform** (`lib/stft.ts`, Hann-windowed, center-padded).
2. The complex spectrogram (real + imaginary parts, cropped to the model's
   frequency range) is packed into a `[1, 4, dimF, dimT]` tensor — channels
   `[Left.real, Left.imag, Right.real, Right.imag]` — and run through an
   **ONNX neural network** (`onnxruntime-web`, in a Web Worker).
3. The network predicts the complex spectrogram of its "primary" stem
   (vocals, for most public models) **directly** — this is a real learned
   prediction, not a magnitude mask reused with the mix's original phase.
4. The frequency axis is zero-padded back out and each chunk is converted
   back to a waveform via the **inverse STFT**, trimming the STFT context
   margin so chunks tile back together with no gaps or overlap.
5. The non-primary stem is computed as `mix − primary` in the time domain.
   This guarantees the two stems always sum back to the original mix
   exactly, avoiding the phase artifacts you'd get from re-synthesizing
   both stems independently.

Inference automatically prefers **WebGPU** when the browser and GPU support
it, and transparently falls back to **WASM** (CPU) otherwise — see
`lib/separationEngine.ts` and `workers/separation.worker.ts`. All of this
runs off the main thread, so the tab stays responsive.

This app deliberately does **not** ship a fake "AI" mode built from EQ,
frequency filtering, or phase-cancellation tricks. If you haven't configured
a real model yet (see below), the app tells you so plainly instead of
pretending to separate anything.

> **Note on fidelity:** real UVR-MDX-Net inference pads chunk edges with
> *reflected* audio before the STFT; this implementation uses zero-padding
> at chunk/frame edges for simplicity, which is a very close approximation
> but not bit-identical to the reference Python implementation. Everything
> else in the pipeline (chunk sizing, tensor layout, frequency cropping,
> mix-minus-primary reconstruction) faithfully matches the reference
> algorithm.

---

## How video processing works

1. `ffmpeg.wasm` demuxes the uploaded video and extracts its audio track as
   WAV (`lib/ffmpegClient.ts` → `extractAudioFromVideo`).
2. That audio goes through the same separation pipeline described above.
3. `ffmpeg.wasm` re-muxes: the **original video stream** (copied, not
   re-encoded, whenever the codec is MP4-legal) is combined with the new
   **instrumental** audio track (encoded as AAC) into a fresh `.mp4`
   container (`muxVideoWithAudio`).
4. If the source video codec can't be copied into an MP4 container as-is
   (this can happen with some MKV files using codecs like VP9 in certain
   configurations), the app automatically falls back to a high-quality
   `libx264` re-encode (`crf 18`) so you still get a fully valid, playable
   MP4 — it never just renames the file.

---

## Bring your own model (required setup step)

**This is the one step you must complete before the app can actually
separate anything.** The repository intentionally does not bundle model
weights, for two reasons:

1. Pretrained vocal-separation weights are typically tens to hundreds of
   megabytes — bundling them would bloat the repo and slow down every
   `git clone`.
2. Model weights carry their own licenses. You should pick a model whose
   license you've actually reviewed and are comfortable deploying under.

Instead, the app downloads a model at runtime from a URL you configure, and
caches it in the browser's IndexedDB after the first use.

### What the model needs to look like

The worker (`workers/separation.worker.ts`) is wired to the real tensor
contract used by **UVR-MDX-Net** ONNX exports:

- Input tensor `"input"`, shape `[1, 4, dimF, dimT]` — the complex STFT of
  a stereo chunk, laid out as channels `[Left.real, Left.imag, Right.real,
  Right.imag]`, cropped to the model's `dimF` frequency bins.
- One output tensor (any name — the app uses whichever output the model
  returns) of the same shape: the complex STFT of the model's "primary"
  stem, predicted directly.

Any UVR-MDX-Net-family ONNX model matches this contract out of the box.

### Where to get a compatible model

The [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
project (an actively-maintained, open-source wrapper around the Ultimate
Vocal Remover model family) documents and distributes a range of ONNX
vocal-separation models. Its model card lists the exact `dim_f`, `n_fft`,
and other parameters for each model — set the matching
`NEXT_PUBLIC_MODEL_*` variables below to whatever your chosen model's card
specifies.

**Please review a model's license and provenance yourself before deploying
it** — don't take any single blog post's word for a download link. We're
intentionally not hardcoding a specific URL into this app for that reason;
treat any model URL (including ones from the project above) as something to
verify, not something to trust blindly.

Once you've picked and downloaded a `.onnx` file, you have two hosting
options:

**Option A — self-host it as a static asset (simplest, no CORS issues):**

```bash
# from the project root
mkdir -p public/models
cp /path/to/your-model.onnx public/models/vocal-model.onnx
```

```bash
# .env.local
NEXT_PUBLIC_MODEL_URL=/models/vocal-model.onnx
```

Files under `public/` are pushed to GitHub and served by Vercel
automatically — no extra config. If the file is larger than 100MB, use
[Git LFS](https://git-lfs.com/) to push it (`git lfs track "*.onnx"`).

**Option B — host it externally** (S3, R2, GCS, another static host) and
point `NEXT_PUBLIC_MODEL_URL` at the full HTTPS URL. The host must send
CORS headers allowing cross-origin `fetch()` (most object storage
providers support this via a one-line bucket policy).

### Wiring it up

```bash
# .env.local (development) or Vercel -> Environment Variables (production)
NEXT_PUBLIC_MODEL_URL=/models/vocal-model.onnx   # or a full https:// URL

# Match these to your chosen model's card if it differs from the common
# UVR-MDX-NET-Voc_FT defaults already set in .env.example:
NEXT_PUBLIC_MODEL_FFT_SIZE=6144
NEXT_PUBLIC_MODEL_HOP_SIZE=1024
NEXT_PUBLIC_MODEL_DIM_F=2048
NEXT_PUBLIC_MODEL_DIM_T=256
NEXT_PUBLIC_MODEL_PRIMARY_STEM=vocals
NEXT_PUBLIC_MODEL_COMPENSATE=1.0
```

Until this is configured, the app is fully functional up through the upload
screen and will show a clear "no separation model configured" message
instead of the vocal remover screens, rather than faking a result.

---

## Running locally

Requires Node.js 18.18+ and npm.

```bash
git clone <your-repo-url>
cd vocal-remover
npm install
cp .env.example .env.local
# edit .env.local and set NEXT_PUBLIC_MODEL_URL (see above)
npm run dev
```

Open http://localhost:3000.

---

## Building

```bash
npm run build
npm start
```

`npm run build` runs a full production build (type checking + linting +
optimized bundling). `npm start` serves that build locally on
http://localhost:3000 so you can sanity-check it before deploying.

---

## Deploying to Vercel

```bash
git add .
git commit -m "Initial commit"
git push
```

Then:

1. Go to [vercel.com/new](https://vercel.com/new) and import your GitHub
   repository.
2. Vercel auto-detects Next.js — no build command changes needed.
3. Under **Environment Variables**, add `NEXT_PUBLIC_MODEL_URL` (and any of
   the optional `NEXT_PUBLIC_MODEL_*` variables your model needs).
4. Deploy.

No custom server, Docker image, Python runtime, persistent filesystem, or
GPU server is required — everything ships as static assets plus the default
Vercel Node runtime for the two tiny static pages this app has.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_MODEL_URL` | **Yes** | _(none)_ | URL (or `/models/...` static path) to the ONNX separation model |
| `NEXT_PUBLIC_MODEL_FFT_SIZE` | No | `6144` | `n_fft` the model was trained with |
| `NEXT_PUBLIC_MODEL_HOP_SIZE` | No | `1024` | STFT hop size |
| `NEXT_PUBLIC_MODEL_DIM_F` | No | `2048` | Frequency bins kept in the model's input/output |
| `NEXT_PUBLIC_MODEL_DIM_T` | No | `256` | Time frames per inference chunk |
| `NEXT_PUBLIC_MODEL_SAMPLE_RATE` | No | `44100` | Sample rate the model was trained at |
| `NEXT_PUBLIC_MODEL_PRIMARY_STEM` | No | `vocals` | Which stem (`vocals` or `instrumental`) the model predicts directly |
| `NEXT_PUBLIC_MODEL_COMPENSATE` | No | `1.0` | Gain-compensation multiplier some model cards specify |
| `NEXT_PUBLIC_MODEL_INPUT_NAME` | No | `input` | ONNX graph input tensor name |
| `NEXT_PUBLIC_MODEL_OUTPUT_NAME` | No | _(first output)_ | ONNX graph output tensor name, if you need to pin a specific one |

All variables are `NEXT_PUBLIC_*` because they're read in the browser: the
model is fetched directly by each visitor's device, never proxied through
your server.

---

## Browser requirements

- A modern evergreen browser: current Chrome, Edge, Firefox, or Safari.
- **WebAssembly** support (universal in supported browsers) is required for
  inference at minimum.
- **WebGPU** is used automatically when available (currently Chrome/Edge
  124+, Firefox behind a flag on some platforms) for faster inference, with
  a transparent fallback to the WASM (CPU) execution provider — WebGPU is
  never required.
- **SharedArrayBuffer**/cross-origin isolation is **not** required — both
  the ONNX runtime and ffmpeg.wasm are configured to run single-threaded so
  the app needs no special COOP/COEP headers.
- Picture-in-picture is used opportunistically on the video player when the
  browser supports the API; the button is hidden otherwise.

---

## Known limitations

These are genuine constraints of doing this work in a browser, called out
honestly rather than papered over:

- **You must supply a model.** See ["Bring your own
  model"](#bring-your-own-model-required-setup-step) above — there is no
  bundled default.
- **Large files are memory-intensive.** Because processing happens in the
  browser's own memory, very long files (multi-hour recordings, multi-GB
  video) can hit browser memory ceilings, especially on mobile devices. The
  app warns above ~350MB and hard-caps uploads at 2GB, but the real ceiling
  depends on your device.
- **Single-threaded WASM/FFmpeg is slower than a multi-threaded or
  server-side setup.** This trade-off was made deliberately to avoid
  requiring COOP/COEP headers, which add deployment complexity and can
  break third-party embeds. If you control your deployment environment and
  want the speed-up, you can switch to the multi-threaded ffmpeg core and
  onnxruntime-web WASM threads by adding the appropriate headers in
  `next.config.mjs` and swapping the core URLs in `lib/ffmpegClient.ts`.
- **Some MKV codecs require a re-encode**, not a copy, to become valid MP4
  (handled automatically — see [How video processing
  works](#how-video-processing-works) — but it does cost extra time and a
  small amount of visual re-encoding loss in that specific case).
- **Separation quality depends entirely on the model you provide.** This
  app supplies the plumbing (STFT, chunking, inference, reconstruction,
  muxing); a stronger or weaker model will produce a correspondingly
  stronger or weaker separation.
- **Mono sources are upmixed to stereo** (both channels duplicated) before
  separation, since the default model contract expects 2 channels.

---

## Troubleshooting

**"No separation model configured"**
Set `NEXT_PUBLIC_MODEL_URL` (see [Bring your own
model](#bring-your-own-model-required-setup-step)) and redeploy/restart the
dev server.

**"Your browser can't run the separation model"**
Your browser lacks WebAssembly support required for inference. Update to
the latest version of Chrome, Edge, Firefox, or Safari.

**"Couldn't download the separation model"**
Usually a network hiccup, or the model URL doesn't send CORS headers
allowing `fetch()` from your domain. Check the browser console for a CORS
error and adjust your model host's bucket/CORS policy.

**"Ran out of memory"**
Try a shorter clip, close other tabs, or switch to a device with more RAM —
this is a genuine device constraint, not a bug you can route around.

**"Failed to fetch" / "Couldn't load the video engine" / "Couldn't load the separation engine"**
The app loads FFmpeg and ONNX Runtime Web's runtime files from CDNs
(`cdn.jsdelivr.net`, with `unpkg.com` as an automatic fallback). Two
distinct causes produce similar-looking errors:
- A blocked/unreachable CDN download (ad-blocker, privacy extension, or
  network/firewall restriction) — the error message will say a file
  "couldn't be downloaded."
- For FFmpeg specifically: its wrapper library spawns its own internal
  worker via a bundler-relative URL, which Next.js's webpack config
  doesn't always resolve correctly for code inside `node_modules`. This is
  worked around in `lib/ffmpegClient.ts` by fetching that worker script
  explicitly from the CDN and passing it as `classWorkerURL` — if you still
  hit a worker-related failure, the error message will say so specifically
  rather than blaming the network.

If you still see this after updating, check the Network tab for the
specific failing request to tell which case you're in.



**Model download is slow on every visit**
Confirm IndexedDB isn't disabled (e.g. some private/incognito modes disable
or heavily restrict it) — `lib/modelCache.ts` will still work but won't
persist across sessions in that case.

**Video won't play after processing**
Open the browser devtools console — if `muxVideoWithAudio` fell back to the
re-encode path, look for the `ffmpeg.wasm` log output there for the
underlying FFmpeg error.

---

## Project structure

```text
vocal-remover/
├── app/
│   ├── layout.tsx          # Root layout, metadata
│   └── page.tsx             # Main app: landing → processing → results/error
├── components/
│   ├── UploadArea.tsx        # Drag-and-drop / file picker
│   ├── MediaCard.tsx         # Post-upload file summary + "Remove Vocals"
│   ├── ProcessingScreen.tsx  # Stepper + progress bar
│   ├── ResultsAudio.tsx      # Two-stem results for audio uploads
│   ├── ResultsVideo.tsx      # Video results
│   ├── AudioPlayer.tsx       # Custom waveform audio player
│   ├── VideoPlayer.tsx       # Custom video player
│   ├── Waveform.tsx          # SVG waveform renderer
│   ├── ErrorState.tsx        # Error screen with retry/choose-another
│   └── PrivacyBadge.tsx
├── lib/
│   ├── types.ts               # Shared types + worker message protocol
│   ├── fileType.ts             # Format detection, formatting helpers
│   ├── audioDecode.ts          # Web Audio API decode/resample
│   ├── wavEncode.ts            # 16-bit PCM WAV encoder
│   ├── fft.ts                  # Radix-2 FFT
│   ├── stft.ts                  # STFT/ISTFT with overlap-add
│   ├── waveformPeaks.ts         # Waveform downsampling for rendering
│   ├── modelConfig.ts           # Env-driven model configuration
│   ├── modelCache.ts             # IndexedDB model caching
│   ├── separationEngine.ts       # Main-thread ⇄ worker orchestration
│   ├── ffmpegClient.ts           # ffmpeg.wasm extract/mux
│   └── download.ts                # Browser download helper
├── workers/
│   └── separation.worker.ts   # ONNX Runtime Web inference (off-main-thread)
├── public/
│   └── models/                # (optional) place a self-hosted model here
├── styles/
│   └── globals.css
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.js
├── .env.example
└── .gitignore
```
