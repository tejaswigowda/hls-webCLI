# hls webCLI

A browser-based librarian for HLS video kept in git, powered by [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) and [Strata](https://github.com/tejaswigowda/strata-editor)'s own publish code. **Git URL in, what it serves out. Video in, versioned release out.** <b><ins>No servers, no accounts, no uploads</ins></b>: your video is decoded and encoded in your browser, and nothing leaves it until you press Publish.

> Part of the **webCLI** family of browser tools, and the publishing half of [Strata](https://strataeditor.dev): Strata publishes one render from its editor; this lists a whole repository of them, versions them, and adds new videos that never saw the editor. Same `render.json`, same tags, same player.

---

## Paper

This tool is an implementation of the **Web-CLI** architecture, described in:

> **The Web-CLI: Verifiable Privacy for Tools, Models, and Inference Engines in the Browser**
> Tejaswi Gowda, Arizona State University.
> arXiv: https://arxiv.org/abs/2608.28950

One property is handled differently here, and says so: see [Privacy & Egress](#privacy--egress).

---

## Key Features

✓ **See what a repository serves** : paste a git URL; every folder holding a `master.m3u8` is listed with its size, rungs, audio, captions, poster, versions and which version the branch serves now

✓ **Versioned releases** : every publish is one commit and one tag, `<name>/v<N>`. A published tag never moves; re-uploading is the next version

✓ **Prepare, then publish** : *Download .zip* and *Publish…* are separate buttons, and publishing says first exactly what it will send, where, and as whom

✓ **Verify** : check every file of a release, and of every mirror its `render.json` names, against `files.sha256`

✓ **Strata's own code** : the ladder, segmenter, playlists, captions, manifest, tags and `render.json` are Strata's modules, pinned and checked by a test, not a reimplementation

✓ **Refuses rather than guesses** : a variable-frame-rate, rotated or non-H.264 file is stopped with a reason code, not packaged into something that stutters on a phone

✓ **Copy embed link** : the play address with `&present=true`, for an `<iframe>`

✓ **An egress ledger** : a counter in the header of every request the page makes; *uploaded* reads 0 B until you publish

---

## When to use this instead of a video platform

A platform hosts your video, re-encodes it, and can change or remove it. This produces a plain folder of fMP4 segments and playlists that any static host can serve (a git repository on jsDelivr works), plus `files.sha256`, so anyone can check that what is being served is what was published. No platform can tell you that. Use it when you want free, provider-independent, verifiable distribution of a video, with versions you can point at forever.

---

## Usage

### ▤ Library

Give it a git URL: `github.com/owner/renders`, `owner/renders@branch`, or `#repo=owner/renders` on the page address.

| Column | Meaning |
|---|---|
| **Serving** | `current` (the folder is the newest tagged version), `behind` (an older one), `unversioned` (its `render.json` names no tag), `untagged` (no `<name>/vN` tags at all) |
| **Versions** | the tags `<name>/v1`, `v2`, …, each linking to GitHub at that tag |
| **Has** | rungs, audio, captions, poster, whether `files.sha256` exists |
| **Play** | Strata's player on the pinned address |
| **Copy embed link** | the same address with `&present=true` |
| **Verify** | every file against `files.sha256`, for the release and each mirror |
| **New vN** | opens Upload & publish with this repository and name filled in |

Reads only. Nothing is written.

### ↑ Upload & publish

1. **Drop an MP4 or MOV.** It is read in the page: size, frame rate, keyframes, B-frames, audio. If it cannot be packaged correctly it is refused here, with the reason.
2. **Choose** the repository, branch, name, which rungs to keep (never larger than the source), whether to keep the audio, and optional WebVTT captions.
3. **Prepare.** The video is decoded once and encoded for every rung with a keyframe every two seconds, cut into whole-GOP segments (about 6 s). Audio becomes one AAC-LC rendition with the encoder's start-up delay measured and recorded. The file tree, sizes and Strata's checks are shown.
4. **Download .zip** (a plain folder, deterministic bytes) **or Publish…**: *"18 files, 2.4 MB, to github.com/me/renders (main) as clip/v3, as @me"*, then **Send it**. One commit, then the tag.
5. A **receipt**: what was sent, where, when, the commit, the tag, the hash of `files.sha256`.

### What is in a release

```
<name>/render.json          what the render says about itself (Strata's version 2)
<name>/files.sha256         the hash of every other file, in `sha256sum -c` format
<name>/master.m3u8          the variants; every one lists the audio codec when there is audio
<name>/poster.jpg
<name>/captions.vtt         with subs/<lang>/index.m3u8 (when captions are supplied)
<name>/720p30/init.mp4  seg00001.m4s …  index.m3u8      (one folder per rung)
<name>/audio/init.mp4   seg00001.m4s …  index.m3u8      (once, shared by every rung)
```

---

## Refusals

Each is a code, and the page shows it with the reason:

| Code | When |
|---|---|
| `not-mp4` | not an MP4 or MOV, or truncated |
| `fragmented-input` | a fragmented MP4 has no sample tables to read |
| `no-video` | no video track |
| `unsupported-codec` | anything but H.264 with its parameter sets in the header (`avc1`) |
| `rotated-input` | the track carries a rotation; the ladder would come out sideways |
| `unknown-frame-rate` | fewer than two frames, or no timing |
| `vfr-input` | frame times are not evenly spaced |
| `fractional-frame-rate` | 29.97, 23.976, …: Strata's ladder places a keyframe every 2 × fps frames, so it takes 24, 25, 30, 50, 60 |
| `no-keyframes` | nothing to start decoding from |

A stream that plays on your machine and stutters on someone's phone is worse than a refusal, because nothing downstream reports it.

---

## What an uploaded video does not claim

Strata's renders carry a time-source audit and per-frame determinism, because Strata draws every frame at `n / fps`. An uploaded file was not drawn that way, so its `render.json` says `time_source_audit.passed: false` and `determinism.frames: false`, with the reasons; its `scene` block names the uploaded file and its SHA-256. The permanent address `strataeditor.dev/video/<tag>/` is recorded only if you tick the box (it is only right for the repository that site serves); otherwise `publication` is the pinned jsDelivr address.

---

## `window.__webcli_result`

```js
{ ok: true, filename: 'clip-v3.zip', size, bytes /* Uint8Array */, blobUrl, slug, tag, version,
  files: [{ path, bytes, sha256 }], renderJson, gate: { ok, failures } }
{ ok: false, code, error }       // a refusal or a failed prepare; code is a reason above
```

Frozen, and identical whether the set is then downloaded or published. The receipt of a publish is a separate `window.__webcli_receipt`.

---

## How It Works

```
 MP4 / MOV ── ingest.js ──► master { samples, keyframes, avcC, fps }     refuses here, with a code
                                  │
                       planLadder │  never larger than the source
                                  ▼
          ladder.js (VideoDecoder → one VideoEncoder per rung)          Strata, WebCodecs
          audio.js  (decodeAudioData → AudioEncoder, delay measured)    Strata, WebCodecs
                                  │
                                  ▼
      fmp4.js → init.mp4 + segments + playlists      publishSet.js → render.json
      filesManifest.js → files.sha256                releases.js → tag <name>/v<N>
                                  │
              ┌───────────────────┴──────────────────┐
              ▼                                      ▼
       Download .zip                    Publish…  (explicit, one commit + tag)
```

- **Ingest** reads the MP4's sample tables itself and hands Strata's ladder exactly what a Strata master is. A file with B-frames is decoded with their own presentation timestamps.
- **Segments** are cut at the first keyframe at or after 6 s; with a two-second keyframe interval that is three whole GOPs, so every segment starts on a keyframe. The tests decode the output with `ffprobe` and check the first frame of every segment is an `I` frame with `key_frame=1`.
- **Audio.** AAC frames are 1024 samples, so a 6 s segment is 281.25 frames and audio and video boundaries do not align exactly; each audio segment starts at the first whole frame at or after the video segment's start. The encoder's start-up delay (2112 samples in Chrome) is measured by encoding a noise burst and recorded in `render.json`.
- **Publishing** is Strata's `commitRelease`: blobs first, then one tree, one commit, one fast-forward ref move, then the tag. A tag that exists by then refuses the publish and writes nothing.

---

## Privacy & Egress

The webCLI family's tools are GET-only and send nothing. **This one has to write**: publishing is a commit to your repository. So the principle here is the one in the paper's wider form: *egress is the user's explicit act, never the tool's default.*

- **Preparing is local.** Your video is never sent anywhere. Preparing makes only GET reads of the repository you named (to find the next version number); they reveal a repository name, not your content.
- **Publishing is a separate button** that shows the files, size, repository, tag and account first, and sends only after *Send it*.
- **Your token** is typed into the page, kept in `sessionStorage` (this tab only), and sent only to `api.github.com` as the `Authorization` header. It is never written to the ledger or to a file.
- **The ledger** in the header counts every request: *uploaded* is request bodies and reads 0 B until you publish; *read* is listing and verifying. It is persisted in `localStorage` and can be cleared from the console (`localStorage.removeItem('hls-webcli:ledger:v1')`).
- **A Content-Security-Policy** limits scripts to this origin and the network to `https:`. It does not name the hosts, because a render's mirrors can be anywhere.

**Zero-egress verification of a prepare:**
1. Open DevTools (F12) → Network tab.
2. Drop a video and press **Prepare**.
3. Every request is a `GET` to `api.github.com`; none has a body. Then **Publish…** shows the first `POST`.

`npm test` checks the same thing: it fails if any request before publishing is not a `GET`, and if the ledger does not read `uploaded 0 B` until the publish.

---

## Running Locally

```bash
npm install        # dev dependencies only (the tests)
npm start          # http://localhost:5510/
```

The app is the static `docs/` folder and has no build step: any static host serves it (GitHub Pages from `/docs` works).

### Tests and Gates

```bash
npm test
```

Needs Google Chrome (the end-to-end tests drive it) and `ffmpeg` / `ffprobe` (to make the fixtures and to decode the output independently). Tests that need them are skipped when they are missing. GitHub and jsDelivr are answered in memory, so no test touches the network.

| Test | What it proves |
|---|---|
| `vendored` | each Strata file is byte-identical to upstream, apart from its declared, marked patches |
| `consume` | Strata's real published `render.json` files (`short`, `cafe`, `a+b-cubed`) validate against Strata's schema and are read without complaint |
| `ingest` | CFR, B-frames, VFR, 29.97, fragmented, HEVC, rotated, one frame, truncated |
| `prepare` | an upload passes Strata's own gate and schema; claims no audit; master lists the audio codec in every variant; one commit and one tag; the second publish is `v2` and `v1` does not move; a taken tag, a rate limit, a failed gate, no token |
| `lib` | URL parsing, the ledger, token handling, stream detection |
| `e2e`, `e2e-ingest` | real Chrome: upload, WebCodecs encode, ffprobe on every segment, publish, ledger, Library, Verify, embed link; a 720p source with B-frames gives a two-rung ladder with every frame at `n / 30` |

---

## Project Structure

```
docs/
  index.html  app.js  style.css      the page
  lib/
    ingest.js      MP4 → Strata master, refusals
    prepare.js     upload → publish set → release; describePublish, publishPrepared
    browse.js      list the streams of a repository
    github.js      the REST calls Strata's release code asks for; trackedFetchBytes
    ledger.js      the egress ledger
    zip.js         a deterministic store-only zip
  strata/          Strata's publish code, vendored (see VENDORED.md)
server.js          static server for docs/
test/              unit, in-memory GitHub, real-Chrome end to end
```

## Dependencies

Runtime: none. The browser's WebCodecs, Web Audio and `crypto.subtle`. No bundler, no CDN, no fonts.
Development: `playwright-core` (drives the installed Chrome) and `ajv` (validates `render.json` against Strata's schema in tests).

---

## Out of Scope

Live streaming; DASH; transcoding beyond the ladder (that is [ffmpeg-webCLI](https://github.com/tejaswigowda/ffmpeg-webCLI)); hosting (the tool produces and verifies, you publish); providers other than GitHub; variable or fractional frame rates; codecs other than H.264; files too large to hold in memory.

---

## Part of the Web-CLI family

A family of browser tools that process your data on your device. All free and open source.

- **[ffmpeg-webCLI](https://github.com/tejaswigowda/ffmpeg-webCLI)** - full FFmpeg in the browser: trim, convert, compress, caption, and 30+ video operations. ([live](https://tejaswigowda.com/ffmpeg-webCLI/))
- **[dub-webCLI](https://github.com/tejaswigowda/dub-webCLI)** - subtitles to timed speech with Kokoro, on-device. ([live](https://tejaswigowda.com/dub-webCLI/))
- **[whisper-webCLI](https://github.com/tejaswigowda/whisper-webCLI)** - speech-to-text with Whisper, ~99 languages, on-device. ([live](https://tejaswigowda.com/whisper-webCLI/))
- **[3mf-webCLI](https://github.com/tejaswigowda/3mf-webCLI)** - GLB to multi-material 3MF for AMS/MMU 3D printing, client-side. ([live](https://tejaswigowda.com/3mf-webCLI/))
- **[strata-editor](https://github.com/tejaswigowda/strata-editor)** - edit and version 3D scenes in the browser; where the publish code here comes from.

Overview of the family: [webcli.app](https://webcli.app/). Architecture paper: [arXiv:2608.28950](https://arxiv.org/abs/2608.28950)

---

## Acknowledgments

- **[Strata](https://github.com/tejaswigowda/strata-editor)** - the fMP4 segmenter, ladder, audio rendition, captions, manifest, release tags, `render.json` and its schema, and the player the Play button opens. Vendored at commit `ce703d5`; see [docs/strata/VENDORED.md](docs/strata/VENDORED.md).
- **[renders](https://github.com/tejaswigowda/renders)** - Strata's published renders, whose real `render.json` files are the consume tests' fixtures.
- **[ffmpeg-webCLI](https://github.com/tejaswigowda/ffmpeg-webCLI)** - sibling project; the family hand-off and design.

---

## License

No `LICENSE` file has been added to this repository yet. The code in `docs/strata/` is Strata's and carries whatever terms `strata-editor` does; add a licence here before the first release.

---

**Questions?** Open an [issue](https://github.com/tejaswigowda/hls-webCLI/issues) or submit a PR.
