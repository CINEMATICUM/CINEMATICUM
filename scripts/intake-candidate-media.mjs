#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";

function fail(message) {
  console.error(`CINEMATICUM_MEDIA_INTAKE_REJECTED: ${message}`);
  process.exit(1);
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

const source = process.argv[2];
if (!source) fail("usage: node scripts/intake-candidate-media.mjs <local-media-file>");

if (!existsSync(source)) fail("source file does not exist");
const stat = statSync(source);
if (!stat.isFile()) fail("source path is not a file");
if (stat.size <= 0) fail("source file is empty");

const sourceName = basename(source).toLowerCase();
if (sourceName.includes("placeholder")) fail("placeholder media is forbidden");

const allowed = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".mp4", ".mov", ".mkv"]);
const ext = extname(sourceName);
if (!allowed.has(ext)) fail(`unsupported media extension: ${ext || "(none)"}`);

const caseRoot = "CASES/CASE_001_THE_LAST_RENDER";
const candidateRoot = `${caseRoot}/VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/CANDIDATES/CANDIDATE_0001`;
const mediaDir = `${candidateRoot}/MEDIA`;
mkdirSync(mediaDir, { recursive: true });

const destName = `s001_candidate_0001_original${ext}`;
const destPath = join(mediaDir, destName);
copyFileSync(source, destPath);

const mediaSha = sha256File(destPath);
const mediaSize = statSync(destPath).size;

const candidateRecordPath = `${candidateRoot}/CANDIDATE_VISUAL_RECORD.json`;
const candidate = readJson(candidateRecordPath);
candidate.schema_version = "0.4.0";
candidate.status = "MEDIA_ATTACHED_HASHED_NOT_SELECTED";
candidate.media_path = `MEDIA/${destName}`;
candidate.media_sha256 = mediaSha;
candidate.media_size_bytes = mediaSize;
candidate.media_type = ext.replace(".", "");
candidate.evaluation.selection_result = "NOT_SELECTED";
candidate.issuance_effect = "None. Candidate media is attached and hashed, but no take is selected and the film is not issued.";
writeJson(candidateRecordPath, candidate);

const visualObjectPath = `${caseRoot}/VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/VISUAL_EVIDENCE_OBJECT.json`;
const visualObject = readJson(visualObjectPath);
visualObject.status = "EVIDENCE_OBJECT_OPEN_CANDIDATE_MEDIA_ATTACHED_NO_TAKE_SELECTED";
visualObject.selected_media = null;
for (const entry of visualObject.candidate_media) {
  if (entry.candidate_id === "CANDIDATE_0001") {
    entry.status = "MEDIA_ATTACHED_HASHED_NOT_SELECTED";
    entry.media_path = `CANDIDATES/CANDIDATE_0001/MEDIA/${destName}`;
    entry.media_sha256 = mediaSha;
    entry.media_size_bytes = mediaSize;
    entry.selected = false;
  }
}
writeJson(visualObjectPath, visualObject);

const mediaHashesPath = `${caseRoot}/OBJECTS/MEDIA_HASHES.json`;
const mediaHashes = readJson(mediaHashesPath);
mediaHashes.schema_version = "0.4.0";
mediaHashes.status = "CANDIDATE_MEDIA_HASH_RECORDED_NO_SELECTED_TAKE";
mediaHashes.media = (mediaHashes.media || []).filter(
  (m) => !(m.case_id === "CASE_001_THE_LAST_RENDER" && m.shot_id === "S001" && m.candidate_id === "CANDIDATE_0001")
);
mediaHashes.media.push({
  case_id: "CASE_001_THE_LAST_RENDER",
  shot_id: "S001",
  candidate_id: "CANDIDATE_0001",
  path: `${candidateRoot}/MEDIA/${destName}`,
  sha256: mediaSha,
  size_bytes: mediaSize,
  selected: false
});
writeJson(mediaHashesPath, mediaHashes);

const spinePath = `${caseRoot}/ISSUANCE_SPINE.json`;
const spine = readJson(spinePath);
spine.spine_status = "CASE_OPEN_CANDIDATE_MEDIA_ATTACHED_NOT_SELECTED_NOT_ISSUED";

const required = `VISUAL_EVIDENCE/S001_DEAD_RENDER_FACILITY/CANDIDATES/CANDIDATE_0001/MEDIA/${destName}`;
if (!spine.required_objects.includes(required)) spine.required_objects.push(required);

spine.forbidden_claims = spine.forbidden_claims.filter(
  (claim) => !["candidate media attached", "candidate media hashed"].includes(claim)
);

for (const claim of ["candidate selected", "selected take exists", "final media selected"]) {
  if (!spine.forbidden_claims.includes(claim)) spine.forbidden_claims.push(claim);
}

writeJson(spinePath, spine);

const result = {
  object_type: "CINEMATICUM_CANDIDATE_MEDIA_INTAKE_RESULT",
  schema_version: "0.4.0",
  jurisdiction: "CINEMATICUM",
  case_id: "CASE_001_THE_LAST_RENDER",
  shot_id: "S001",
  candidate_id: "CANDIDATE_0001",
  valid: true,
  media_path: `${candidateRoot}/MEDIA/${destName}`,
  media_sha256: mediaSha,
  media_size_bytes: mediaSize,
  selected: false,
  proves_film_issued: false,
  proves_truth: false,
  proves_admissibility: false
};

writeJson(`${caseRoot}/PROOFS/candidate-media-intake-result.json`, result);
console.log(JSON.stringify(result, null, 2));
