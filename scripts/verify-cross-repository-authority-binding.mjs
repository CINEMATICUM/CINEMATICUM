import fs from "node:fs";
import process from "node:process";

function fail(message) {
  console.error(`FAIL=${message}`);
  process.exit(1);
}

const binding = JSON.parse(
  fs.readFileSync(
    "AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_BINDING.json",
    "utf8"
  )
);

const current = JSON.parse(
  fs.readFileSync(
    "CURRENT/CURRENT_CASE.json",
    "utf8"
  )
);

const charter = JSON.parse(
  fs.readFileSync(
    "CHARTER_OF_CINEMATIC_JURISDICTION.json",
    "utf8"
  )
);

if (binding.object_type !== "CINEMATICUM_REPOSITORY_AUTHORITY_BINDING") fail("OBJECT_TYPE");
if (binding.schema_version !== "1.0.0") fail("SCHEMA");
if (binding.root_sentence !== "CINEMATICUM issues admissible motion pictures.") fail("ROOT_SENTENCE");
if (charter.root_sentence !== binding.root_sentence) fail("CHARTER_DRIFT");

if (binding.issuance_jurisdiction.repository !== "CINEMATICUM/CINEMATICUM") fail("ISSUANCE_REPOSITORY");
if (binding.issuance_jurisdiction.role !== "CANONICAL_ISSUANCE_JURISDICTION") fail("ISSUANCE_ROLE");

if (binding.production_replay_track.repository !== "kaaffilm/CINEMATICUM") fail("PRODUCTION_REPOSITORY");
if (binding.production_replay_track.admissibility_authority !== false) fail("PRODUCTION_ADMISSIBILITY_AUTHORITY");
if (binding.production_replay_track.issuance_authority !== false) fail("PRODUCTION_ISSUANCE_AUTHORITY");

if (current.current_case !== "CASE_001_THE_LAST_RENDER") fail("CURRENT_CASE");
if (current.current_status !== "CASE_OPEN_NOT_ISSUED") fail("CURRENT_CASE_STATUS");

if (binding.case_001.issuance_status !== current.current_status) fail("CASE_STATUS_BINDING");
if (binding.case_001.production_artifact_admissible_motion_picture_issuance_effect !== "NONE") fail("ARTIFACT_ISSUANCE_EFFECT");
if (binding.case_001.production_replay_success_implies_admissible_motion_picture_issuance !== false) fail("REPLAY_ISSUANCE_BOUNDARY");
if (binding.case_001.artifact_existence_implies_admissibility !== false) fail("ARTIFACT_ADMISSIBILITY_BOUNDARY");

if (binding.lineage.source_merge_authorized !== false) fail("SOURCE_MERGE_BOUNDARY");
if (binding.lineage.repository_deletion_authorized !== false) fail("REPOSITORY_DELETE_BOUNDARY");

if (binding.reciprocal_binding.production_repository_acknowledgement_required !== true) fail("ACK_REQUIREMENT");
if (binding.reciprocal_binding.production_repository_acknowledgement_present !== false) fail("PREMATURE_ACK");
if (binding.reciprocal_binding.full_cross_repository_canonicality_resolved !== false) fail("PREMATURE_CANONICALITY");

if (binding.adapter_boundary.adapter_implementation_eligible_before_reciprocal_ack !== false) fail("PREMATURE_ADAPTER_ELIGIBILITY");

console.log("CINEMATICUM_CROSS_REPOSITORY_AUTHORITY_BINDING=PASS");
console.log("ISSUANCE_JURISDICTION=CINEMATICUM/CINEMATICUM");
console.log("PRODUCTION_REPLAY_TRACK=kaaffilm/CINEMATICUM");
console.log("CASE_STATUS=CASE_OPEN_NOT_ISSUED");
console.log("PRODUCTION_ARTIFACT_IMPLIES_ADMISSIBLE_MOTION_PICTURE_ISSUANCE=false");
console.log("SOURCE_MERGE_ALLOWED=false");
console.log("RECIPROCAL_ACK_PENDING=true");
console.log("FULL_CROSS_REPOSITORY_CANONICALITY_RESOLVED=false");
