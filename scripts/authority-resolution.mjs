import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BINDING = 'f2966e7e2b758cf5c6355db0bf8d8587bcfad750fd30f3bfef77b40434593e41';
const ACK = '7e2a59156d6611b940b158a402e75d9add47a25aa60c728f8f340c4d50a63abd';
const MERGE = 'e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4';
const ISSUANCE_MERGE = '517fd51f43ae8a17db219da352f5b83998d45fbd';
const ACK_PATH = 'AUTHORITY/CINEMATICUM_PRODUCTION_REPOSITORY_AUTHORITY_ACKNOWLEDGEMENT.json';
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const blob = bytes => hash('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
const check = (condition, message) => { if (!condition) throw new Error(`AUTHORITY_RESOLUTION_${message}`); };

export function verifyAuthorityResolution(root = '.') {
  const filename = path.join(root,'AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_RESOLUTION.json');
  if (!fs.existsSync(filename)) return null; // Historical pre-ack checkout remains valid as historical evidence.
  const resolution = JSON.parse(fs.readFileSync(filename,'utf8'));
  check(resolution.object_type === 'CINEMATICUM_REPOSITORY_AUTHORITY_RESOLUTION' && resolution.schema_version === '1.0.0' &&
    resolution.resolution_type === 'PROJECTION_OF_ALREADY_ACCEPTED_RECIPROCAL_ACKNOWLEDGEMENT','TYPE');
  const original=resolution.original_binding, accepted=resolution.accepted_acknowledgement, effective=resolution.effective_projection;
  check(original.repository==='CINEMATICUM/CINEMATICUM' && original.accepted_merge_sha===ISSUANCE_MERGE && original.path==='AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_BINDING.json' && original.sha256===BINDING && original.preserved_byte_for_byte===true,'ORIGINAL_IDENTITY');
  const bindingBytes=fs.readFileSync(path.join(root,original.path));
  check(hash('sha256',bindingBytes)===BINDING && blob(bindingBytes)===original.blob,'ORIGINAL_BYTES');
  check(accepted.repository==='kaaffilm/CINEMATICUM' && accepted.accepted_merge_sha===MERGE && accepted.production_main_observed_at_commit===MERGE && accepted.path===ACK_PATH && accepted.sha256===ACK && accepted.new_acknowledgement_created===false && accepted.evidence_copy==='AUTHORITY/EVIDENCE/production-acknowledgement-e83e0074.json','ACK_IDENTITY');
  check(accepted.source_url===`https://github.com/kaaffilm/CINEMATICUM/blob/${MERGE}/${ACK_PATH}` && accepted.main_observation_url==='https://api.github.com/repos/kaaffilm/CINEMATICUM/branches/main','SOURCE_URL');
  const ackBytes=fs.readFileSync(path.join(root,accepted.evidence_copy)), acknowledgement=JSON.parse(ackBytes);
  check(hash('sha256',ackBytes)===ACK && blob(ackBytes)===accepted.blob && accepted.blob==='9bb05354c7ce88eeb1eb9f6b76e9b6ac00b3940d','ACK_BYTES');
  check(acknowledgement.issuance_jurisdiction.accepted_merge_sha===ISSUANCE_MERGE && acknowledgement.issuance_jurisdiction.authority_binding_sha256===BINDING && acknowledgement.issuance_jurisdiction.authority_binding_blob===original.blob,'RECIPROCITY');
  check(acknowledgement.governance_transition.on_accepted_merge_full_cross_repository_canonicality_resolved===true && acknowledgement.governance_transition.on_accepted_merge_adapter_implementation_eligible===true,'ACK_EFFECT');
  check(effective.production_repository_acknowledgement_present===true && effective.full_cross_repository_canonicality_resolved===true && effective.adapter_implementation_eligible===true && effective.adapter_only_integration_required===true,'EFFECT');
  check(effective.issuance_jurisdiction==='CINEMATICUM/CINEMATICUM' && effective.production_replay_track==='kaaffilm/CINEMATICUM','ROLES');
  check(effective.case_status==='CASE_OPEN_NOT_ISSUED' && effective.source_merge_authorized===false && effective.repository_deletion_authorized===false && effective.history_rewrite_authorized===false && effective.production_artifact_implies_admissibility===false && effective.production_replay_success_implies_issuance===false,'BOUNDARIES');
  return resolution;
}

export async function recheckAcceptedAcknowledgement(fetchImpl=fetch) {
  const read=async suffix=>{
    const response=await fetchImpl(`https://api.github.com/repos/kaaffilm/CINEMATICUM/${suffix}`,{headers:{Accept:'application/vnd.github+json'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    check(response.status===200,'REMOTE_READ');return response.json();
  };
  const main=await read('branches/main');
  check(/^[a-f0-9]{40}$/.test(main.commit?.sha),'REMOTE_MAIN');
  if(main.commit.sha!==MERGE){const compare=await read(`compare/${MERGE}...${main.commit.sha}`);check(['ahead','identical'].includes(compare.status) && compare.merge_base_commit?.sha===MERGE,'MERGE_NOT_ANCESTOR');}
  const file=await read(`contents/${ACK_PATH}?ref=${main.commit.sha}`);
  check(file.sha==='9bb05354c7ce88eeb1eb9f6b76e9b6ac00b3940d' && file.encoding==='base64' && hash('sha256',Buffer.from(file.content,'base64'))===ACK,'REMOTE_ACK');
  return {main_sha:main.commit.sha,accepted_acknowledgement_merge:MERGE,live_remote_rechecked:true};
}
