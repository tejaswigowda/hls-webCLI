# hls webCLI

A browser tool for HLS libraries kept in git: **see what a repository serves, version it, add new videos, publish.** It is Strata's publish path taken out of the editor. Nothing is uploaded anywhere until you press Publish.

```
npm install        # dev only: tests
npm start          # http://localhost:5510/
npm test           # unit tests + real-Chrome end to end (needs Google Chrome and ffmpeg for the fixtures)
```

## What it does

**Library.** Give it a git URL (`github.com/owner/renders`, `owner/renders@branch`, or `#repo=owner/renders` in the page address). It lists every folder holding a `master.m3u8`: size, rungs, audio, captions, poster, whether it has a `files.sha256`, the versions it was tagged as (`<name>/v<N>`), and which version the branch serves now (`current`, `behind`, `unversioned`, `untagged`). **Verify** checks every file of the pinned release, and of every mirror its `render.json` names, against `files.sha256`. **Play** opens Strata's player on the pinned address. Reads only.

**Upload & publish.** Drop an MP4 / MOV. It is read in the page and either refused with a reason code or turned into a ladder (WebCodecs), with the audio as an AAC rendition (encoder delay measured and recorded), optional WebVTT captions, poster, `render.json` and `files.sha256`. *Prepare* shows the file tree and the checks; *Download .zip* and *Publish…* are separate buttons. Publishing says first what it will send (`18 files, 2.4 MB, to github.com/me/renders (main) as clip/v3, as @me`), commits it as one commit, creates the tag `clip/v3` (a published tag never moves; a re-upload is the next version), and shows a receipt.

`window.__webcli_result` holds `{ ok, filename, size, bytes, blobUrl, tag, files, renderJson, gate }` (or `{ ok: false, code, error }`), the same whether the set is downloaded or published; the receipt of a publish is `window.__webcli_receipt`.

The counter in the header is the ledger of every request the page makes: *uploaded* is request bodies and reads 0 until you publish; *read* is listing and verifying.

## Where the code is from

`docs/strata/` is Strata's own publish code, copied from `strata-editor` and pinned (see [VENDORED.md](docs/strata/VENDORED.md): four small patches, and a test that fails if anything else is edited). The format is Strata's `render.json` version 2, validated against Strata's published schema. What this repository adds, in `docs/lib/`:

| | |
|---|---|
| `ingest.js` | reads an MP4 into the `master` Strata's ladder takes; refuses with a reason code |
| `prepare.js` | wires an upload to Strata's functions, plans the version, publishes the set |
| `browse.js` | lists the streams of a repository |
| `github.js`, `ledger.js`, `zip.js` | the REST calls Strata's release code asks for, the ledger, a store-only zip |

## Refusals

`not-mp4`, `fragmented-input`, `no-video`, `unsupported-codec` (H.264 `avc1` only), `rotated-input`, `unknown-frame-rate`, `vfr-input`, `fractional-frame-rate` (Strata's ladder places a keyframe every 2 × fps frames, so it takes whole frame rates: 24, 25, 30, 50, 60), `no-keyframes`. A file that plays here and stutters on a phone is worse than a refusal.

## What an uploaded video does not claim

Strata's renders carry a time-source audit and per-frame determinism. An upload was not drawn by that renderer, so its `render.json` says `time_source_audit.passed: false`, `determinism.frames: false` and the reasons, and its `scene` block names the uploaded file and its SHA-256. The permanent address `strataeditor.dev/video/<tag>/` is recorded only if you tick the box; otherwise `publication` is the pinned jsDelivr address.

## Limits

* The whole file is held in memory: fine for a clip, not for a feature film.
* H.264 in MP4 / MOV only; whole frame rates only; one audio track; GitHub only (git data API, one commit per release).
* Browsers without an AAC encoder (`AudioEncoder`) cannot keep audio; drop it to package the picture alone. Desktop Chrome and Edge work.