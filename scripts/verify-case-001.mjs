#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = "CASES/CASE_001_THE_LAST_RENDER";
const PROOF_DIR = `${ROOT}/PROOFS`;
const RESULT_PATH = `${PROOF_DIR}/case-001-verification-result.json`;

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(errors) {
  const result = {
    object_type: "CINEMATICUM_CASE_001_VERIFICATION_RESULT",
    schema_version: "0.6.0",
    jurisdiction: "CINEMATICUM",
    case_id: "CASE_001_THE_LAST_RENDER",
    valid: false,
    errors,
    proves_film_issued: false,
    proves_truth: false,
    proves_admissibility: false
  };
  mkdirSync(PROOF_DIR, { recursive: true });
  writeJson(RESULT_PATH, result);
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

const errors = [];

const spinePath = `${ROOT}/ISSUANCE_SPINE.json`;
if (!existsSync(spinePath)) fail(["missing issuance spine"]);

const spine = readJson(spinePath);

const baseObjects = [
  "CASE_CHARTER.json",
  "ISSUANCE_SPINE.json",
  "OBJECTS/DIRECTORIAL_AUTHORITY.json",
  "OBJECTS/SCRIPT_LOCK.json",
  "OBJECTS/SHOT_FUNCTION_LOCK.json",
  "OBJECTS/SELECTED_TAKE_RECORD.json",
  "OBJECTS/FINAL_CUT_TIMELINE.json",
  "OBJECTS/RELEASE_MANIFEST.json",
  "OBJECTS/MEDIA_HASHES.json",
  "OBJECTS/ISSUANCE_RECEIPT.json",
  "OBJECTS/OUTSIDER_REPLAY_BUNDLE.json",
  "OBJECTS/TERMINAL_CLOSURE.json"
];

const required = Array.from(new Set([
  ...baseObjects,
  ...(spine.required_objects || [])
]));

const verifiedObjects = [];
const parsedJsonObjects = [];

for (const rel of required) {
  const path = rel.startsWith("CASES/") ? rel : join(ROOT, rel);

  if (!existsSync(path)) {
    errors.push(`missing required object: ${rel}`);
    continue;
  }

  const sha256 = sha256File(path);
  const sizeBytes = readFileSync(path).length;

  verifiedObjects.push({
    path,
    sha256,
    size_bytes: sizeBytes,
    binary: !path.endsWith(".json")
  });

  if (path.endsWith(".json")) {
    try {
      parsedJsonObjects.push({ path, value: readJson(path) });
    } catch {
      errors.push(`invalid json object: ${path}`);
    }
  }
}

for (const { path, value } of parsedJsonObjects) {
  const serialized = JSON.stringify(value);

  if (serialized.includes('"proves_truth":true')) {
    errors.push(`truth overclaim: ${path}`);
  }

  if (serialized.includes('"proves_admissibility":true')) {
    errors.push(`admissibility overclaim: ${path}`);
  }

  if (serialized.includes('"external_api_used":true')) {
    errors.push(`external API usage admitted: ${path}`);
  }

  if (serialized.includes('"external_media_used":true')) {
    errors.push(`external media usage admitted: ${path}`);
  }
}

const status = spine.spine_status || "UNKNOWN";
const filmIssued = status === "CASE_001_SELF_RENDERED_COMPILER_CUT_ISSUED";

if (filmIssued) {
  const manifestPath = `${ROOT}/FILM/COMPILER_CUT_MANIFEST.json`;
  const filmPath = `${ROOT}/FILM/CASE_001_THE_LAST_RENDER_COMPILER_CUT_0001.mp4`;

  if (!existsSync(manifestPath)) errors.push("missing compiler cut manifest");
  if (!existsSync(filmPath)) errors.push("missing compiler cut MP4");

  if (existsSync(manifestPath) && existsSync(filmPath)) {
    const manifest = readJson(manifestPath);
    const actualSha = sha256File(filmPath);
    const actualSize = readFileSync(filmPath).length;

    if (manifest.artifact_sha256 !== actualSha) {
      errors.push("compiler cut MP4 sha256 mismatch");
    }

    if (manifest.artifact_size_bytes !== actualSize) {
      errors.push("compiler cut MP4 size mismatch");
    }

    if (manifest.generation?.external_api_used !== false) {
      errors.push("manifest does not reject external API use");
    }

    if (manifest.generation?.external_media_used !== false) {
      errors.push("manifest does not reject external media use");
    }

    if (manifest.generation?.manual_media_selection_used !== false) {
      errors.push("manifest does not reject manual media selection");
    }

    if (manifest.generation?.candidate_selection_used !== false) {
      errors.push("manifest does not reject candidate selection");
    }
  }
}

if (errors.length) fail(errors);

const result = {
  object_type: "CINEMATICUM_CASE_001_VERIFICATION_RESULT",
  schema_version: filmIssued ? "0.6.0" : "0.4.0",
  jurisdiction: "CINEMATICUM",
  case_id: "CASE_001_THE_LAST_RENDER",
  valid: true,
  status,
  verified_objects: verifiedObjects,
  forbidden_claims_enforced: spine.forbidden_claims || [],
  proves_compiler_generated_film: filmIssued,
  proves_film_issued: filmIssued,
  proves_truth: false,
  proves_admissibility: false,
  proves_external_reality: false
};

mkdirSync(PROOF_DIR, { recursive: true });
writeJson(RESULT_PATH, result);
console.log(JSON.stringify(result, null, 2));
