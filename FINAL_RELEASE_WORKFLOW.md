# Final-film acceptance and issuance

This workflow implements a separate final-film gate. It does not rewrite the historical compiler-cut verifier, reinterpret an earlier compiler pass, select takes, supply artistic approval, or close Case 001 automatically.

The implementation checks the final authority and lock chain, complete file hashes, selected-take provenance records, normalized timeline coverage, decoded media, delivery-to-master identity, authorized artistic decisions, an independent public replay, and a final issuance authorization. Successful finalization writes a new immutable record. Missing, conflicting, altered or unapproved inputs refuse issuance.

## Current case and authority

`CASE_001_THE_LAST_RENDER` remains `CASE_OPEN_NOT_ISSUED`. Its existing draft authority, draft locks, empty selected-take record and compiler cut cannot pass this gate. No production approval, witness signature, final film or final issuance record is included with this change.

The cross-repository acknowledgement was already merged in production commit [`e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4`](https://github.com/kaaffilm/CINEMATICUM/commit/e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4). The new authority resolution projects that accepted relationship. Its evidence copy is byte-identical to the [existing acknowledgement](https://github.com/kaaffilm/CINEMATICUM/blob/e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4/AUTHORITY/CINEMATICUM_PRODUCTION_REPOSITORY_AUTHORITY_ACKNOWLEDGEMENT.json). The original jurisdiction binding remains byte-identical to the blob and SHA-256 that acknowledgement accepted.

```bash
node scripts/verify-cross-repository-authority-binding.mjs
node scripts/verify-cross-repository-authority-binding.mjs --online
```

The first command checks the pinned snapshot and its exact bytes offline. `--online` additionally checks production main, accepted-merge ancestry and the exact acknowledgement at that current head through public GitHub. Neither command grants production issuance authority, source-merge authority, history rewriting, repository deletion or a case-status change.

## Requirements and deliberate scope

Use Node.js 22 or later and local `ffmpeg`/`ffprobe` executables. The implementation was exercised with Node.js 24.19.0 and FFmpeg 6.1.1. It uses Node's built-in cryptography, filesystem, child-process and fetch APIs; no npm packages, paid APIs or rendering service are required.

Version 1 accepts normalized, zero-origin, constant-frame-rate cuts. Timeline segments refer to selected-take frame ranges; all locked shots must have selections, all selections must be used and the assembled ranges must be contiguous. Video counts, frame rates, timestamp continuity, audio layouts and exact sample counts are decoded and checked. Variable-speed edits, transitions, general OTIO/AAF conform, subtitles/data streams and non-normalized mixed-rate source timelines need a later schema and are refused rather than silently approximated.

The delivery must decode to exactly the locked picture master and sound master. Video is compared in RGBA64LE; sound is compared as 32-bit PCM in deterministic 1,024-sample blocks. A lossless FFV1/PCM master is suitable. A lossy delivery that changes approved picture pixels or PCM samples fails this master gate; compressed distribution derivatives require their own later acceptance record. This comparison does not add HDR mastering, OCIO management, calibrated monitoring or image-quality assessment.

The editor signs the actual final edit and selected-take relationship. The validator checks the complete lock/reference chain and declared source ranges; it does not reconstruct arbitrary color effects from original take pixels. The director explicitly signs acceptance of image, sound, silence, performance, rhythm, cut and audience experience. Provenance statements are authenticated production attestations bound to the actual media hash, not machine proof that an event happened or that an operator never used an external service. These limits are reflected by `proves_truth:false` and `proves_external_reality:false` in every receipt.

Each decoder process is foreground and limited to 120 seconds; a timeout refuses acceptance. Media are bounded to 64 GiB per file, 500,000 frames, 33,554,432 pixels per frame, 240 fps and at most 192 kHz/32-channel audio. JSON is limited to 2 MiB, package downloads to 128 GiB, and manifests to 256 assets. These are checked safety and resource bounds, not production-scale performance claims. Do not increase them without measuring and testing the intended workload.

## Trust and explicit decisions

Maintain an approved trust policy **outside** the untrusted release package. It binds one case and test/production scope to Ed25519 public keys, principal identifiers and roles:

```json
{
  "case_id": "CASE_001_THE_LAST_RENDER",
  "keys": [
    {
      "key_id": "SHA256_OF_ED25519_SPKI_DER",
      "principal_id": "APPROVED_PRODUCTION_PRINCIPAL",
      "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "roles": ["director", "editor", "sound", "color", "release", "issuer"]
    },
    {
      "key_id": "SHA256_OF_INDEPENDENT_ED25519_SPKI_DER",
      "principal_id": "APPROVED_INDEPENDENT_WITNESS",
      "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
      "roles": ["replay"]
    }
  ],
  "schema": "cinematicum-release-trust-v1",
  "test_fixture": false
}
```

This is a structural example, not an approval policy or usable key. Approve real keys and the people/entities they represent through the jurisdiction's existing authority process. A package cannot introduce its own trusted signer. A replay key must have only the replay role; its principal must differ from every production and issuer principal. Distinct keys alone do not establish independent people: principal assignment must be trustworthy outside the submitted package.

Private keys stay outside the repository and release. The signing command requires owner-only file permissions and an explicitly approved payload; it never creates a key, selects an authority or changes `REVIEW_REQUIRED` to `APPROVE`. Signatures authenticate configured keys and bound decisions. Software cannot infer artistic acceptance or a person's identity from a JSON field.

## Canonical package

All JSON uses UTF-8, recursively sorted object keys, two-space indentation and one trailing newline. Numbers must be safe integers; rates are `{ "num": 24, "den": 1 }`. `jsonBytes` in `scripts/final-release/core.mjs` provides the exact encoding. Duplicate-key JSON, absolute paths, traversal, symlinks, duplicate paths and ambiguous public filenames are rejected.

`manifest.json` contains:

| Field | Required value |
| --- | --- |
| `schema` | `cinematicum-final-release-v1` |
| `case_id`, `release_id` | Explicit bounded identifiers |
| `test_fixture` | Boolean; true exactly when `case_id` begins `ENGINE_TEST_` |
| `objects` | Descriptors for `authority`, `script`, `shots`, `selection`, `timeline`, `sound`, `grade` |
| `assets` | Bounded list of `{id, kind, file, expected?}`; kind is `document` or `media` |
| `delivery_media_id` | The delivery asset identifier |
| `approvals` | Exactly one `{role, file}` for director, editor, sound, color and release |

Each file descriptor is `{path, public_name, sha256, size_bytes}`. `path` is inside the local package, `public_name` is its unique flat GitHub Release asset name, and SHA-256 covers the entire file. `manifest.json` and `PREPARATION.json` are reserved. Every asset must be used by the accepted script, selections or masters; unrelated/unbound assets fail.

All seven object records include `schema`, `object_type`, `case_id`, `release_id`, and `status`. `object_type` is the corresponding manifest role. The authority status is `FINAL`; every other status is `LOCKED`.

| Object | Additional required data |
| --- | --- |
| Authority | `authorized_keys:[{key_id, role}]`, matching each production signer |
| Script lock | `script_asset_id`, referencing the actual screenplay document asset |
| Shot-function lock | `script_sha256` and nonempty `shots:[{id,function}]` |
| Selection | `shots_sha256` and nonempty `takes:[{id,shot_id,media_id,provenance_asset_id}]` |
| Timeline | `selection_sha256`, rational `fps`, `frame_count`, `picture_media_id`, and contiguous `segments:[{take_id,source_in_frame,duration_frames,timeline_in_frame}]` |
| Sound lock | `timeline_sha256` and `media_id` for the audio-only locked mix |
| Grade lock | `timeline_sha256` and `picture_sha256` for the locked graded picture |

A take's provenance document binds `case_id`, `take_id`, and `media_sha256`; requires `source_type:"LOCAL_PRODUCTION"`, `paid_api_used:false`, `cloud_render_used:false`, `placeholder:false`; and requires nonempty `method` and `source_record`. These are signed attestations and references, not automatic verification of real-world provenance.

Each media asset declares `expected.video` and/or `expected.audio`:

```json
{
  "audio": { "channels": 2, "sample_rate": 48000, "samples": 48000 },
  "video": { "fps": { "den": 1, "num": 24 }, "frames": 24, "height": 1080, "width": 1920 }
}
```

Declare only streams actually present. Every declared frame and sample is decoded, all stream layouts checked, and all input hashes rechecked after decoding. The prepared report binds the validator source hash, driver source hash, trust-policy hash, manifest, all file hashes, decoded media measurements and signer identities.

## Execute the workflow

### 1. Build and review the frozen package

Produce the actual selected takes, approved script and shot functions, final timeline, mix and picture masters. Write their complete descriptors and lock hashes. The package manifest includes approval descriptors after the following signing step. The signed **content identity excludes the approval descriptors** so signing has no circular dependency, while the prepared manifest hash includes the actual approval envelopes.

Generate one unsigned payload per production role:

```bash
node scripts/final-release.mjs approval-payload --package /work/release-package --role director --out /work/director-review.json
```

The authorized person reviews the real work and edits this canonical payload to `decision:"APPROVE"`, with a current ISO UTC `signed_at`. The director must also explicitly set every audience-review field to `ACCEPTED`. Other roles use the same command with their respective role. Then sign the reviewed payload:

```bash
node scripts/final-release.mjs sign --payload /work/director-review.json --key /secure/director.pem --out /work/release-package/director-approval.json
```

Record each approval envelope's descriptor in the manifest. Changes to any lock, selected take, asset identity or delivery identity invalidate the old production approvals. This process must be done by the approved authorities; do not turn engine-test fixture signatures into production approvals.

### 2. Verify and prepare

```bash
node scripts/final-release.mjs verify --package /work/release-package --trust /secure/case-trust.json
node scripts/final-release.mjs prepare --package /work/release-package --trust /secure/case-trust.json
```

`verify` performs a full check without writing a receipt. `prepare` performs the same checks and creates `PREPARATION.json` exclusively. It refuses overwriting an earlier preparation. Its state is `READY_FOR_PUBLIC_REPLAY`, with issuance and admissibility claims still false. If any source changes, prepare a new release identifier and new package, reviews and signatures.

### 3. Publish the exact approved bytes

Through the repository's authorized release process, publish `manifest.json`, `PREPARATION.json`, every object, media/document asset and approval envelope as public GitHub Release assets using their exact `public_name`. The workflow performs no upload and consumes no paid API. Media stay outside Git source history. The public manifest URL must use either bounded CINEMATICUM repository and this form:

```text
https://github.com/CINEMATICUM/CINEMATICUM/releases/download/RELEASE_TAG/manifest.json
```

Private drafts, authenticated downloads, local files, unrelated domains, query credentials and unsupported redirect hosts are not accepted as public replay sources. Publish only the approved package; never include trust private keys.

### 4. Independent public replay

The independent witness obtains the approved trust policy outside the download and runs the same verified code:

```bash
node scripts/final-release.mjs replay --manifest-url https://github.com/CINEMATICUM/CINEMATICUM/releases/download/RELEASE_TAG/manifest.json --out /witness/new-capture --trust /witness/approved-case-trust.json --key /witness/replay.pem
```

This command creates a new directory, downloads the public package without authentication, checks every byte identity, fully decodes every medium, compares the result with the exact preparation, and signs `INDEPENDENT_REPLAY.json` with the trusted independent key. It cannot reuse a producer's local package as public replay. `PUBLIC_CAPTURE.json` records the source URL, capture time and each downloaded file hash. Failures preserve partial bytes and `CAPTURE_FAILURE.json`, without writing a successful replay.

The caller's execution and principal separation are enforced by the configured trust policy, not by physical-device attestation. The witness's signed statement attests that this public replay actually occurred. A dishonest trusted signer remains outside what cryptographic verification alone can detect.

### 5. Explicit issuance and immutable finalization

Return the witness's signed replay to the issuance authority. Generate the final unsigned decision only after revalidating the complete package and replay:

```bash
node scripts/final-release.mjs issuance-payload --package /work/release-package --trust /secure/case-trust.json --replay /work/INDEPENDENT_REPLAY.json --out /work/issuance-review.json
```

The authorized issuer reviews it and explicitly approves/signs it:

```bash
node scripts/final-release.mjs sign --payload /work/issuance-review.json --key /secure/issuer.pem --out /work/ISSUANCE_AUTHORIZATION.json
node scripts/final-release.mjs finalize --package /work/release-package --trust /secure/case-trust.json --replay /work/INDEPENDENT_REPLAY.json --authorization /work/ISSUANCE_AUTHORIZATION.json --out /work/new-final-record
```

Finalization reruns media and cross-object acceptance. It creates the preparation, replay, authorization, release manifest, final issuance receipt, terminal closure and a last-written `COMMITTED.json` marker. A partial directory without that marker is not a finalized record. All files are exclusive writes; an existing record is never overwritten. The receipt binds preparation, replay and authorization digests and the actual delivery descriptor.

A real approved production package receives `ISSUED_ADMISSIBLE_MOTION_PICTURE`; an engine fixture always receives `TEST_FIXTURE_ACCEPTED_NOT_ISSUED`, with film/admissibility claims false and no case closure. Finalization produces records, and explicitly reports `repository_case_projection_updated:false`. Publish/review those records in the canonical issuance jurisdiction through its ordinary acceptance process before updating the repository's current-case projection. The tool never silently rewrites a historical compiler spine or a current-case status file.

Verify a finalized record against the actual package at any later time:

```bash
node scripts/final-release.mjs verify-final --package /work/release-package --trust /secure/case-trust.json --finalized /work/new-final-record
```

This revalidates the actual media and signed decisions, commit-marker hashes, manifest, recomputed receipt and terminal closure. Rehashing a forged receipt into the commit marker does not make it valid.

## Verification and remaining acceptance

```bash
node --test tests/final-release.test.mjs tests/authority-resolution.test.mjs
node scripts/verify-case-001.mjs
```

Tests generate short FFV1 video and PCM audio, decode the actual files, exercise preparation/finalization/record verification, and check missing or forged approvals, wrong cases, selection gaps, source ranges, prohibited provenance, malformed JSON, symlinks/traversal, public-byte substitution, unsafe redirects, wrong sample/frame counts, replacement mixes, stale preparations, witness independence and attempted test-to-production promotion.

Public-download tests use an injected transport with fixture bytes and do not claim that a real production GitHub Release or independent person was tested. Real public replay and production issuer acceptance remain required for a real case. Test media and private keys are temporary, never committed, and use `ENGINE_TEST_` identifiers. Tests accept `CINEMATICUM_TEST_TMPDIR` when the default temporary directory is unavailable. On restricted environments without process isolation support, Node's `--test-isolation=none` runs the same tests in one process; it does not disable any acceptance checks.
