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

const CASE_ID = "CASE_001_THE_LAST_RENDER";
const TITLE = "The Last Render";
const ROOT = `CASES/${CASE_ID}`;
const FILM_DIR = `${ROOT}/FILM`;
const BUILD_DIR = `.cinematicum-build/${CASE_ID}`;
const FRAME_DIR = `${BUILD_DIR}/frames`;
const AUDIO_PATH = `${BUILD_DIR}/score.wav`;
const FILM_PATH = `${FILM_DIR}/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4`;
const MANIFEST_PATH = `${FILM_DIR}/COMPILER_CUT_MANIFEST.json`;
const TIMELINE_PATH = `${FILM_DIR}/COMPILER_TIMELINE.json`;
const PROOF_PATH = `${ROOT}/PROOFS/autonomous-film-compile-result.json`;

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 24;
const SAMPLE_RATE = 48000;

const SHOTS = [
  {
    id: "S001",
    title: "Dead Render Facility",
    seconds: 6,
    function: "establish the dead render facility as a silent witness chamber"
  },
  {
    id: "S002",
    title: "Corrupted Timeline Vault",
    seconds: 6,
    function: "show the missing timeline as broken light, not exposition"
  },
  {
    id: "S003",
    title: "Machine Memory Corridor",
    seconds: 7,
    function: "move through a corridor of dormant render machines"
  },
  {
    id: "S004",
    title: "Last Admissible Witness",
    seconds: 7,
    function: "isolate the witness position without showing a person"
  },
  {
    id: "S005",
    title: "The Gate Refuses Noise",
    seconds: 6,
    function: "separate lawful signal from dead image noise"
  },
  {
    id: "S006",
    title: "The Last Render",
    seconds: 8,
    function: "make the final projection beam become the film artifact itself"
  }
];

function fail(message) {
  console.error(`CINEMATICUM_COMPILER_REJECTED: ${message}`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: options.stdio ?? "pipe" }).toString();
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
    fail("ffmpeg is required as a local encoder. No remote API is used.");
  }
}

function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function noise(x, y, t) {
  let n = (x * 374761393 + y * 668265263 + t * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function lineGlow(xn, yn, x1, y1, x2, y2, width, power) {
  const ax = xn - x1;
  const ay = yn - y1;
  const bx = x2 - x1;
  const by = y2 - y1;
  const h = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by)));
  const dx = ax - bx * h;
  const dy = ay - by * h;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - d / width) * power;
}

function addBlock(pixel, xn, yn, x1, y1, x2, y2, edge = 20) {
  if (xn > x1 && xn < x2 && yn > y1 && yn < y2) {
    pixel.r *= 0.25;
    pixel.g *= 0.25;
    pixel.b *= 0.28;

    if (
      Math.abs(xn - x1) < 0.002 ||
      Math.abs(xn - x2) < 0.002 ||
      Math.abs(yn - y1) < 0.003 ||
      Math.abs(yn - y2) < 0.003
    ) {
      pixel.r += edge;
      pixel.g += edge;
      pixel.b += edge;
    }
  }
}

function renderPixel(x, y, globalFrame, shot, localFrame, localTotal) {
  const xn = x / WIDTH;
  const yn = y / HEIGHT;
  const p = localFrame / Math.max(1, localTotal - 1);
  const centerDrift = 0.5 + 0.018 * Math.sin(p * Math.PI * 2);

  const pixel = {
    r: 4 + yn * 7,
    g: 4 + yn * 7,
    b: 5 + yn * 9
  };

  const vignette = Math.max(
    0.12,
    1 - ((xn - 0.5) ** 2 * 1.75 + (yn - 0.52) ** 2 * 1.38)
  );

  if (shot.id === "S001") {
    addBlock(pixel, xn, yn, 0.09, 0.57, 0.22, 0.86, 22);
    addBlock(pixel, xn, yn, 0.25, 0.54, 0.34, 0.86, 18);
    addBlock(pixel, xn, yn, 0.66, 0.54, 0.75, 0.86, 18);
    addBlock(pixel, xn, yn, 0.78, 0.57, 0.91, 0.86, 22);

    const beamWidth = 0.018 + Math.max(0, yn - 0.30) * 0.32;
    const beam = Math.abs(xn - centerDrift) < beamWidth
      ? (1 - Math.abs(xn - centerDrift) / beamWidth) * 75 * (1 - p * 0.15)
      : 0;

    pixel.r += beam;
    pixel.g += beam;
    pixel.b += beam * 0.96;
  }

  if (shot.id === "S002") {
    for (let i = 0; i < 9; i++) {
      const yline = 0.20 + i * 0.065 + 0.01 * Math.sin(p * 5 + i);
      const glow = lineGlow(xn, yn, 0.15, yline, 0.85, yline + 0.03 * Math.sin(i), 0.004, 55);
      pixel.r += glow;
      pixel.g += glow;
      pixel.b += glow;
    }

    if (noise(x, y, globalFrame) > 0.996) {
      pixel.r += 95;
      pixel.g += 95;
      pixel.b += 95;
    }
  }

  if (shot.id === "S003") {
    const corridor = Math.abs(xn - 0.5) < 0.34 - yn * 0.22;
    if (corridor && yn > 0.1) {
      pixel.r += 12;
      pixel.g += 12;
      pixel.b += 13;
    }

    for (let i = 0; i < 7; i++) {
      const z = (i / 7 + p * 0.35) % 1;
      const yb = 0.22 + z * 0.58;
      const w = 0.025 + z * 0.06;
      addBlock(pixel, xn, yn, 0.16 - w, yb, 0.24 - w * 0.3, yb + 0.11, 24);
      addBlock(pixel, xn, yn, 0.76 + w * 0.3, yb, 0.84 + w, yb + 0.11, 24);
    }

    pixel.r += lineGlow(xn, yn, 0.50, 0.18, 0.50, 0.86, 0.006, 48);
    pixel.g += lineGlow(xn, yn, 0.50, 0.18, 0.50, 0.86, 0.006, 48);
    pixel.b += lineGlow(xn, yn, 0.50, 0.18, 0.50, 0.86, 0.006, 48);
  }

  if (shot.id === "S004") {
    const platform = yn > 0.62 && Math.abs(xn - 0.5) < 0.25 + (yn - 0.62) * 0.8;
    if (platform) {
      pixel.r += 18;
      pixel.g += 18;
      pixel.b += 19;
    }

    const witnessVoid = Math.sqrt((xn - 0.5) ** 2 / 0.006 + (yn - 0.46) ** 2 / 0.030);
    if (witnessVoid < 1) {
      pixel.r *= 0.15;
      pixel.g *= 0.15;
      pixel.b *= 0.18;
    }

    const halo = Math.max(0, 1 - Math.abs(witnessVoid - 1.05) / 0.12) * 42;
    pixel.r += halo;
    pixel.g += halo;
    pixel.b += halo;
  }

  if (shot.id === "S005") {
    const gateX1 = 0.28;
    const gateX2 = 0.72;
    const gateY1 = 0.18;
    const gateY2 = 0.82;
    addBlock(pixel, xn, yn, gateX1, gateY1, gateX2, gateY2, 35);

    const slit = Math.abs(yn - 0.50) < 0.004 && xn > 0.32 && xn < 0.68;
    if (slit) {
      pixel.r += 150;
      pixel.g += 150;
      pixel.b += 146;
    }

    const leftNoise = xn < 0.28 && noise(x, y, globalFrame) > 0.985;
    if (leftNoise) {
      pixel.r += 80;
      pixel.g += 80;
      pixel.b += 80;
    }

    const rightStill = xn > 0.72 ? 0.65 : 1;
    pixel.r *= rightStill;
    pixel.g *= rightStill;
    pixel.b *= rightStill;
  }

  if (shot.id === "S006") {
    const aperture = Math.abs(yn - 0.32) < 0.005 && Math.abs(xn - 0.5) < 0.045;
    if (aperture) {
      pixel.r += 180;
      pixel.g += 180;
      pixel.b += 176;
    }

    const expansion = 0.03 + p * 0.55;
    const beam = Math.abs(xn - 0.5) < expansion * Math.max(0.2, yn)
      ? (1 - Math.abs(xn - 0.5) / (expansion * Math.max(0.2, yn))) * (90 + p * 90)
      : 0;

    if (yn > 0.30) {
      pixel.r += beam;
      pixel.g += beam;
      pixel.b += beam * 0.97;
    }

    const finalWhite = Math.max(0, (p - 0.82) / 0.18) * 210;
    pixel.r += finalWhite;
    pixel.g += finalWhite;
    pixel.b += finalWhite;
  }

  if (yn > 0.72) {
    const floor = Math.max(0, 1 - Math.abs(xn - centerDrift) / 0.28) * Math.max(0, 1 - (yn - 0.72) / 0.24) * 28;
    pixel.r += floor;
    pixel.g += floor;
    pixel.b += floor;
  }

  const dustZone = yn > 0.18 && yn < 0.88 && noise(x, y, globalFrame + 17) > 0.9975;
  if (dustZone) {
    pixel.r += 60;
    pixel.g += 60;
    pixel.b += 60;
  }

  pixel.r *= vignette;
  pixel.g *= vignette;
  pixel.b *= vignette;

  return [clamp(pixel.r), clamp(pixel.g), clamp(pixel.b)];
}

function writePpm(path, globalFrame, shot, localFrame, localTotal) {
  const header = `P6\n${WIDTH} ${HEIGHT}\n255\n`;
  const data = Buffer.alloc(WIDTH * HEIGHT * 3);
  let i = 0;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = renderPixel(x, y, globalFrame, shot, localFrame, localTotal);
      data[i++] = r;
      data[i++] = g;
      data[i++] = b;
    }
  }

  writeFileSync(path, Buffer.concat([Buffer.from(header), data]));
}

function writeWav(path, seconds) {
  const channels = 1;
  const bits = 16;
  const samples = Math.floor(seconds * SAMPLE_RATE);
  const dataSize = samples * channels * bits / 8;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels * bits / 8, 28);
  buffer.writeUInt16LE(channels * bits / 8, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  let cursor = 0;
  const cuts = [];
  for (const shot of SHOTS) {
    cuts.push(cursor);
    cursor += shot.seconds;
  }

  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    let nearestCut = 999;
    for (const cut of cuts) nearestCut = Math.min(nearestCut, Math.abs(t - cut));

    const drone =
      Math.sin(2 * Math.PI * 43.2 * t) * 0.30 +
      Math.sin(2 * Math.PI * 64.8 * t) * 0.18 +
      Math.sin(2 * Math.PI * 97.1 * t) * 0.09;

    const pulse = Math.exp(-nearestCut * 9) * Math.sin(2 * Math.PI * 31 * t) * 0.48;
    const shimmer = Math.sin(2 * Math.PI * (240 + 20 * Math.sin(t * 0.7)) * t) * 0.018;
    const fadeIn = Math.min(1, t / 3);
    const fadeOut = Math.min(1, (seconds - t) / 4);

    const sample = Math.max(-1, Math.min(1, (drone + pulse + shimmer) * fadeIn * fadeOut));
    buffer.writeInt16LE(Math.round(sample * 32767), offset);
    offset += 2;
  }

  writeFileSync(path, buffer);
}

function ensureNoExternalMediaInputs() {
  const declaredExternalInputs = [];
  const generationContract = {
    external_api_used: false,
    external_media_used: false,
    manual_media_selection_used: false,
    candidate_selection_used: false
  };

  if (declaredExternalInputs.length !== 0) {
    fail("external inputs are forbidden for autonomous compiler");
  }

  for (const [key, value] of Object.entries(generationContract)) {
    if (value !== false) {
      fail(`autonomous compiler contract violation: ${key}`);
    }
  }
}

assertFfmpeg();
ensureNoExternalMediaInputs();

rmSync(BUILD_DIR, { recursive: true, force: true });
mkdirSync(FRAME_DIR, { recursive: true });
mkdirSync(FILM_DIR, { recursive: true });
mkdirSync(`${ROOT}/PROOFS`, { recursive: true });

let globalFrame = 0;
const timeline = [];
let timelineCursor = 0;

for (const shot of SHOTS) {
  const frames = shot.seconds * FPS;

  timeline.push({
    shot_id: shot.id,
    title: shot.title,
    start_seconds: timelineCursor,
    duration_seconds: shot.seconds,
    frame_start: globalFrame,
    frame_count: frames,
    function: shot.function,
    source: "procedural compiler law",
    external_media_used: false,
    candidate_selection_used: false
  });

  for (let localFrame = 0; localFrame < frames; localFrame++) {
    writePpm(
      join(FRAME_DIR, `frame_${String(globalFrame).padStart(5, "0")}.ppm`),
      globalFrame,
      shot,
      localFrame,
      frames
    );
    globalFrame++;
  }

  timelineCursor += shot.seconds;
}

writeWav(AUDIO_PATH, timelineCursor);

execFileSync("ffmpeg", [
  "-y",
  "-framerate", String(FPS),
  "-i", `${FRAME_DIR}/frame_%05d.ppm`,
  "-i", AUDIO_PATH,
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "128k",
  "-shortest",
  "-movflags", "+faststart",
  FILM_PATH
], { stdio: "inherit" });

const filmSha = sha256File(FILM_PATH);
const audioSha = sha256File(AUDIO_PATH);
const filmSize = readFileSync(FILM_PATH).length;
const audioSize = readFileSync(AUDIO_PATH).length;

const manifest = {
  object_type: "CINEMATICUM_COMPILER_CUT_MANIFEST",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  title: TITLE,
  compiler_cut_id: "COMPILER_CUT_0001",
  artifact_path: "CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
  artifact_sha256: filmSha,
  artifact_size_bytes: filmSize,
  width: WIDTH,
  height: HEIGHT,
  fps: FPS,
  duration_seconds: timelineCursor,
  frame_count: globalFrame,
  audio: {
    mode: "procedural_pcm_synthesis",
    sample_rate: SAMPLE_RATE,
    local_build_path: ".cinematicum-build/CASE_001_THE_LAST_RENDER/score.wav",
    sha256: audioSha,
    size_bytes: audioSize
  },
  generation: {
    mode: "AUTONOMOUS_FILM_COMPILER",
    external_api_used: false,
    external_media_used: false,
    manual_media_selection_used: false,
    candidate_selection_used: false,
    ffmpeg_used_as_local_encoder: true
  },
  claims: {
    proves_compiler_generated_film: true,
    proves_truth: false,
    proves_admissibility: false,
    proves_external_reality: false
  }
};

const compilerTimeline = {
  object_type: "CINEMATICUM_COMPILER_TIMELINE",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  title: TITLE,
  compiler_cut_id: "COMPILER_CUT_0001",
  timeline
};

writeJson(MANIFEST_PATH, manifest);
writeJson(TIMELINE_PATH, compilerTimeline);

writeJson(`${ROOT}/OBJECTS/FINAL_CUT_TIMELINE.json`, {
  object_type: "CINEMATICUM_FINAL_CUT_TIMELINE",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  status: "COMPILER_CUT_EXISTS",
  final_cut_id: "COMPILER_CUT_0001",
  timeline_path: "FILM/COMPILER_TIMELINE.json",
  media_path: "FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
  selection_model: "NO_CANDIDATE_SELECTION_AUTONOMOUS_COMPILER_OUTPUT",
  claims: {
    proves_truth: false,
    proves_admissibility: false,
    proves_external_reality: false
  }
});

writeJson(`${ROOT}/OBJECTS/MEDIA_HASHES.json`, {
  object_type: "CINEMATICUM_MEDIA_HASHES",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  complete: true,
  media: [
    {
      media_id: "COMPILER_CUT_0001_MP4",
      path: "FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
      sha256: filmSha,
      size_bytes: filmSize,
      generated_by: "CINEMATICUM_AUTONOMOUS_FILM_COMPILER",
      external_api_used: false,
      external_media_used: false
    }
  ]
});

writeJson(`${ROOT}/OBJECTS/RELEASE_MANIFEST.json`, {
  object_type: "CINEMATICUM_RELEASE_MANIFEST",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  release_id: "CASE_001_COMPILER_CUT_0001",
  release_status: "ISSUED_COMPILER_CUT",
  artifact: {
    path: "FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
    sha256: filmSha,
    size_bytes: filmSize
  },
  generation_basis: "autonomous procedural compiler",
  external_api_used: false,
  external_media_used: false,
  manual_media_selection_used: false,
  claims: {
    proves_film_artifact_issued: true,
    proves_truth: false,
    proves_admissibility: false,
    proves_external_reality: false
  }
});

writeJson(`${ROOT}/OBJECTS/ISSUANCE_RECEIPT.json`, {
  object_type: "CINEMATICUM_ISSUANCE_RECEIPT",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  issued_object: "COMPILER_CUT_0001",
  issued_at: new Date().toISOString(),
  artifact_path: "FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
  artifact_sha256: filmSha,
  artifact_size_bytes: filmSize,
  authority: "CINEMATICUM_AUTONOMOUS_FILM_COMPILER",
  claims: {
    proves_compiler_generated_film: true,
    proves_truth: false,
    proves_admissibility: false,
    proves_external_reality: false
  }
});

const spinePath = `${ROOT}/ISSUANCE_SPINE.json`;
const spine = readJson(spinePath);
spine.schema_version = "0.6.0";
spine.spine_status = "CASE_001_SELF_RENDERED_COMPILER_CUT_ISSUED";
spine.required_objects = Array.from(new Set([
  ...(spine.required_objects || []),
  "FILM/COMPILER_CUT_MANIFEST.json",
  "FILM/COMPILER_TIMELINE.json",
  "FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4",
  "OBJECTS/FINAL_CUT_TIMELINE.json",
  "OBJECTS/MEDIA_HASHES.json",
  "OBJECTS/RELEASE_MANIFEST.json",
  "OBJECTS/ISSUANCE_RECEIPT.json"
]));
spine.forbidden_claims = Array.from(new Set([
  "truth verified",
  "admissibility decided outside CINEMATICUM standard",
  "external API used",
  "external media used",
  "manual media selected",
  "candidate selected",
  "unhashed media",
  "unverified binary artifact"
]));
writeJson(spinePath, spine);

const proof = {
  object_type: "CINEMATICUM_AUTONOMOUS_FILM_COMPILE_RESULT",
  schema_version: "0.6.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  valid: true,
  artifact_path: FILM_PATH,
  artifact_sha256: filmSha,
  artifact_size_bytes: filmSize,
  duration_seconds: timelineCursor,
  frame_count: globalFrame,
  shots: SHOTS.length,
  external_api_used: false,
  external_media_used: false,
  manual_media_selection_used: false,
  candidate_selection_used: false,
  proves_compiler_generated_film: true,
  proves_truth: false,
  proves_admissibility: false,
  proves_external_reality: false
};

writeJson(PROOF_PATH, proof);
console.log(JSON.stringify(proof, null, 2));
