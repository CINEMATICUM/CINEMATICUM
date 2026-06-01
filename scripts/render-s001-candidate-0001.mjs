#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

function fail(message) {
  console.error(`CINEMATICUM_SELF_RENDER_REJECTED: ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: "pipe" }).toString();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertFfmpeg() {
  try {
    run("ffmpeg", ["-version"]);
  } catch {
    fail("ffmpeg is required for self-rendered MP4 output");
  }
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hashNoise(x, y, t) {
  let n = x * 374761393 + y * 668265263 + t * 1442695041;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function writePpm(path, width, height, frame, totalFrames) {
  const header = `P6\n${width} ${height}\n255\n`;
  const data = Buffer.alloc(width * height * 3);

  const phase = frame / Math.max(1, totalFrames - 1);
  const beamPulse = 0.72 + 0.16 * Math.sin(phase * Math.PI * 2.0);
  const dustPhase = frame * 7;

  let i = 0;

  for (let y = 0; y < height; y++) {
    const yn = y / height;

    for (let x = 0; x < width; x++) {
      const xn = x / width;

      // Matte-black architectural base.
      let r = 5 + yn * 7;
      let g = 5 + yn * 7;
      let b = 6 + yn * 8;

      // Back wall.
      if (y > height * 0.16 && y < height * 0.82 && x > width * 0.10 && x < width * 0.90) {
        r += 5;
        g += 5;
        b += 6;
      }

      // Projection aperture.
      const apertureY = height * 0.34;
      const apertureX1 = width * 0.46;
      const apertureX2 = width * 0.54;
      if (y > apertureY - 3 && y < apertureY + 3 && x > apertureX1 && x < apertureX2) {
        r += 120;
        g += 120;
        b += 118;
      }

      // Projection beam: triangular cone from back wall into lower frame.
      const beamCenter = 0.50 + 0.012 * Math.sin(phase * Math.PI * 2.0);
      const beamWidth = 0.018 + Math.max(0, yn - 0.30) * 0.30;
      const beamDist = Math.abs(xn - beamCenter);
      if (yn > 0.30 && yn < 0.88 && beamDist < beamWidth) {
        const beam = (1 - beamDist / beamWidth) * (1 - (yn - 0.30) * 0.82) * 82 * beamPulse;
        r += beam;
        g += beam;
        b += beam * 0.96;
      }

      // Dormant render-machine blocks.
      const blocks = [
        [0.12, 0.62, 0.22, 0.84],
        [0.25, 0.57, 0.33, 0.84],
        [0.67, 0.57, 0.75, 0.84],
        [0.78, 0.62, 0.88, 0.84]
      ];

      for (const [x1, y1, x2, y2] of blocks) {
        if (xn > x1 && xn < x2 && yn > y1 && yn < y2) {
          r = 2 + yn * 5;
          g = 2 + yn * 5;
          b = 3 + yn * 6;

          // Thin dead edge-light.
          if (Math.abs(xn - x1) < 0.002 || Math.abs(xn - x2) < 0.002 || Math.abs(yn - y1) < 0.003) {
            r += 24;
            g += 24;
            b += 24;
          }
        }
      }

      // Floor reflection, weak and lawful.
      if (yn > 0.72) {
        const floorGlow = Math.max(0, 1 - Math.abs(xn - beamCenter) / 0.22) * Math.max(0, 1 - (yn - 0.72) / 0.22) * 28;
        r += floorGlow;
        g += floorGlow;
        b += floorGlow;
      }

      // Dust particles inside projection cone.
      const dust = hashNoise(x, y, dustPhase);
      if (dust > 0.997 && yn > 0.28 && yn < 0.88 && Math.abs(xn - beamCenter) < beamWidth * 1.4) {
        const d = 60 + 60 * hashNoise(y, x, dustPhase);
        r += d;
        g += d;
        b += d;
      }

      // Vignette.
      const dx = xn - 0.5;
      const dy = yn - 0.52;
      const vignette = Math.max(0.20, 1 - (dx * dx * 1.8 + dy * dy * 1.3));
      r *= vignette;
      g *= vignette;
      b *= vignette;

      data[i++] = clamp(r);
      data[i++] = clamp(g);
      data[i++] = clamp(b);
    }
  }

  writeFileSync(path, Buffer.concat([Buffer.from(header), data]));
}

const caseRoot = "CASES/CASE_001_THE_LAST_RENDER";
const candidateRoot = `${caseRoot}/VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/CANDIDATES/CANDIDATE_0001`;
const renderRoot = `${candidateRoot}/SELF_RENDER`;
const frameRoot = `${renderRoot}/frames`;
const outputPath = `${renderRoot}/s001_candidate_0001_self_render.mp4`;
const manifestPath = `${renderRoot}/SELF_RENDER_MANIFEST.json`;

assertFfmpeg();

rmSync(renderRoot, { recursive: true, force: true });
mkdirSync(frameRoot, { recursive: true });

const width = 960;
const height = 540;
const fps = 24;
const durationSeconds = 4;
const totalFrames = fps * durationSeconds;
const seed = "CINEMATICUM_CASE_001_S001_CANDIDATE_0001_SELF_RENDER_V0_5_0";

for (let frame = 0; frame < totalFrames; frame++) {
  const path = join(frameRoot, `frame_${String(frame).padStart(4, "0")}.ppm`);
  writePpm(path, width, height, frame, totalFrames);
}

execFileSync("ffmpeg", [
  "-y",
  "-framerate", String(fps),
  "-i", `${frameRoot}/frame_%04d.ppm`,
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  outputPath
], { stdio: "inherit" });

const mediaSha = sha256File(outputPath);
const mediaSize = readFileSync(outputPath).length;

const manifest = {
  object_type: "CINEMATICUM_SELF_RENDER_MANIFEST",
  schema_version: "0.5.0",
  jurisdiction: "CINEMATICUM",
  case_id: "CASE_001_THE_LAST_RENDER",
  shot_id: "S001",
  candidate_id: "CANDIDATE_0001",
  render_engine: "cinematicum-procedural-ppm-x264",
  render_seed: seed,
  width,
  height,
  fps,
  duration_seconds: durationSeconds,
  frame_count: totalFrames,
  output_path: "s001_candidate_0001_self_render.mp4",
  output_sha256: mediaSha,
  output_size_bytes: mediaSize,
  "visual_law": "Dead matte-black render facility; projection beam as last surviving authority; no people, no UI, no cyberpunk, no explanatory text.",
  claims: {
    proves_truth: false,
    proves_admissibility: false,
    proves_film_issued: false,
    proves_self_render_capability: true
  }
};

writeJson(manifestPath, manifest);

// Pass generated media through the existing hard intake gate.
execFileSync("node", ["scripts/intake-candidate-media.mjs", outputPath], { stdio: "inherit" });

// Promote records from generic media intake to self-rendered media intake.
const candidatePath = `${candidateRoot}/CANDIDATE_VISUAL_RECORD.json`;
const candidate = readJson(candidatePath);
candidate.schema_version = "0.5.0";
candidate.status = "SELF_RENDERED_MEDIA_ATTACHED_HASHED_NOT_SELECTED";
candidate.generation = {
  mode: "SELF_RENDERED_BY_CINEMATICUM",
  manifest_path: "SELF_RENDER/SELF_RENDER_MANIFEST.json",
  render_seed: seed,
  render_engine: "cinematicum-procedural-ppm-x264"
};
candidate.evaluation.selection_result = "NOT_SELECTED";
candidate.issuance_effect = "None. CINEMATICUM self-rendered candidate media is attached and hashed, but no take is selected and the film is not issued.";
writeJson(candidatePath, candidate);

const visualObjectPath = `${caseRoot}/VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/VISUAL_EVIDENCE_OBJECT.json`;
const visual = readJson(visualObjectPath);
visual.status = "EVIDENCE_OBJECT_OPEN_SELF_RENDERED_CANDIDATE_MEDIA_ATTACHED_NO_TAKE_SELECTED";
for (const entry of visual.candidate_media) {
  if (entry.candidate_id === "CANDIDATE_0001") {
    entry.status = "SELF_RENDERED_MEDIA_ATTACHED_HASHED_NOT_SELECTED";
    entry.generated_by = "CINEMATICUM_SELF_RENDER_ENGINE";
    entry.self_render_manifest = "CANDIDATES/CANDIDATE_0001/SELF_RENDER/SELF_RENDER_MANIFEST.json";
    entry.selected = false;
  }
}
writeJson(visualObjectPath, visual);

const spinePath = `${caseRoot}/ISSUANCE_SPINE.json`;
const spine = readJson(spinePath);
spine.spine_status = "CASE_OPEN_SELF_RENDERED_CANDIDATE_MEDIA_NOT_SELECTED_NOT_ISSUED";

for (const required of [
  "VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/CANDIDATES/CANDIDATE_0001/SELF_RENDER/SELF_RENDER_MANIFEST.json",
  "VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/CANDIDATES/CANDIDATE_0001/SELF_RENDER/s001_candidate_0001_self_render.mp4"
]) {
  if (!spine.required_objects.includes(required)) spine.required_objects.push(required);
}

spine.forbidden_claims = spine.forbidden_claims.filter(
  (claim) => !["candidate media attached", "candidate media hashed"].includes(claim)
);

for (const claim of [
  "candidate selected",
  "selected take exists",
  "final media selected",
  "final cut exists",
  "film issued"
]) {
  if (!spine.forbidden_claims.includes(claim)) spine.forbidden_claims.push(claim);
}

writeJson(spinePath, spine);

const result = {
  object_type: "CINEMATICUM_SELF_RENDER_RESULT",
  schema_version: "0.5.0",
  jurisdiction: "CINEMATICUM",
  case_id: "CASE_001_THE_LAST_RENDER",
  shot_id: "S001",
  candidate_id: "CANDIDATE_0001",
  valid: true,
  media_path: `${candidateRoot}/SELF_RENDER/s001_candidate_0001_self_render.mp4`,
  media_sha256: mediaSha,
  media_size_bytes: mediaSize,
  selected: false,
  proves_self_render_capability: true,
  proves_film_issued: false,
  proves_truth: false,
  proves_admissibility: false
};

writeJson(`${caseRoot}/PROOFS/self-render-result.json`, result);
console.log(JSON.stringify(result, null, 2));
