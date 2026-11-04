# Vendored from Strata

Everything in this folder is Strata's own code, copied from
[`tejaswigowda/strata-editor`](https://github.com/tejaswigowda/strata-editor) at commit `ce703d517497334398c04d2506d5b148fa26e481`.
It is the publish path of Strata's Render tab, taken out of the editor: nothing here is a reimplementation.

| here | upstream | what it does |
|---|---|---|
| `fmp4.js` | `docs/editor/js/export/fmp4.js` | fragmented-MP4 writer, `init.mp4` + `seg00001.m4s`…, `index.m3u8`, `master.m3u8` |
| `ladder.js` | `…/export/ladder.js` | WebCodecs: decode once, encode every rung (keyframe every 2 s) |
| `audio.js` | `…/export/audio.js` | AAC-LC rendition, encoder-delay measurement |
| `captions.js` | `…/export/captions.js` | WebVTT tracks, their records, the subtitle group |
| `publishSet.js` | `…/export/publishSet.js` | the file set of one render, size gates |
| `renderJson.js` | `…/export/renderJson.js` | `render.json` (version 2) and its validator |
| `filesManifest.js` | `…/export/filesManifest.js` | `files.sha256`, and checking a location against it |
| `releases.js` | `…/export/releases.js` | names, `<name>/v<N>` tags, the publication block, `planRelease` / `commitRelease` |
| `verify-publication.mjs` | `tools/verify-publication.mjs` | does every mirror hold the published bytes |
| `frames.js`, `encoderInfo.js`, `frameHashes.js`, `records.js` | `…/export/` | dependencies of the above |
| `render.schema.json` | `docs/schemas/render.schema.json` | the published schema of `render.json` |

`vendored.json` records the upstream SHA-256 of each file. `test/vendored.test.mjs` fails if an unpatched file differs from it, or if a patched file
carries a different number of `hls-webcli patch` markers than declared, so a silent edit cannot happen.

## The patches (all small, all marked `hls-webcli patch`)

1. **`ladder.js`**: `master.ptsUs` (optional). An uploaded file can have B-frames; its samples are then fed to the decoder with their own presentation
   timestamps (still on the `n / fps` grid) instead of `n / fps` in decode order. Without it the decoder's output order would not match the check.
2. **`publishSet.js`** and **`renderJson.js`**: `audit` and `audioAbsence` are passed through. Upstream always writes `time_source_audit.passed: true`
   and says "The scene has no narration"; neither is true of an uploaded video, so an upload writes `passed: false` and its own sentence.
3. **`verify-publication.mjs`**: imports point at this folder, and `process` is not touched when the module is loaded in a page.

To update: copy the files again from the commit you want, update `vendored.json`, and re-apply the patches (`git diff` against the old copy shows them).
Strata's `exporter` string (`strata-export/1.2.0`) is written into `render.json` as upstream writes it: it names the code that made the set.
