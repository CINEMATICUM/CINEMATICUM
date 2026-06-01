import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const CASE_ID = "CASE_001_THE_LAST_RENDER";
const caseRoot = path.join(ROOT, "CASES", CASE_ID);
const spinePath = path.join(caseRoot, "ISSUANCE_SPINE.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sha256(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function fail(message) {
  console.error(`CINEMATICUM_CASE_VERIFY_FAIL=${message}`);
  process.exit(1);
}

if (!fs.existsSync(spinePath)) fail("missing issuance spine");

const spine = readJson(spinePath);

if (spine.object_type !== "CINEMATICUM_ISSUANCE_SPINE") fail("wrong spine object_type");
if (spine.jurisdiction !== "CINEMATICUM") fail("wrong jurisdiction");
if (spine.case_id !== CASE_ID) fail("wrong case_id");
if (!["CASE_OPEN_NOT_ISSUED", "CASE_OPEN_SCRIPT_AND_SHOT_LAW_LOCKED_NOT_ISSUED", "CASE_OPEN_CANDIDATE_VISUAL_PROMPT_LOCKED_NOT_ISSUED"].includes(spine.spine_status)) fail("wrong case open status");
if (!Array.isArray(spine.required_objects) || spine.required_objects.length < 10) fail("insufficient required objects");

const manifest = {
  object_type: "CINEMATICUM_CASE_001_VERIFICATION_RESULT",
  schema_version: spine.spine_status === "CASE_OPEN_CANDIDATE_VISUAL_PROMPT_LOCKED_NOT_ISSUED" ? "0.3.0" : spine.spine_status === "CASE_OPEN_SCRIPT_AND_SHOT_LAW_LOCKED_NOT_ISSUED" ? "0.2.0" : "0.1.0",
  jurisdiction: "CINEMATICUM",
  case_id: CASE_ID,
  valid: true,
  status: spine.spine_status,
  verified_objects: [],
  forbidden_claims_enforced: spine.forbidden_claims,
  proves_film_issued: false,
  proves_truth: false,
  proves_admissibility: false
};

for (const rel of spine.required_objects) {
  const p = path.join(caseRoot, rel);
  if (!fs.existsSync(p)) fail(`missing required object: ${rel}`);

  const obj = readJson(p);
  if (rel !== "CASE_CHARTER.json") {
    if (obj.jurisdiction !== "CINEMATICUM") fail(`wrong jurisdiction: ${rel}`);
    if (obj.case_id !== CASE_ID) fail(`wrong case_id: ${rel}`);
    if (!obj.status) fail(`missing status: ${rel}`);
  }

  manifest.verified_objects.push({
    path: `CASES/${CASE_ID}/${rel}`,
    sha256: sha256(p)
  });
}

fs.mkdirSync(path.join(caseRoot, "PROOFS"), { recursive: true });
fs.writeFileSync(
  path.join(caseRoot, "PROOFS", "case-001-verification-result.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);

console.log(JSON.stringify(manifest, null, 2));
