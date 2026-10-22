import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifyAuthorityResolution, recheckAcceptedAcknowledgement } from '../scripts/authority-resolution.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const projection='AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_RESOLUTION.json';
const evidence='AUTHORITY/EVIDENCE/production-acknowledgement-e83e0074.json';
const merge='e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4';
test('accepted reciprocal projection verifies without changing original binding or case status',()=>{
  const resolution=verifyAuthorityResolution(root);
  assert.equal(resolution.effective_projection.full_cross_repository_canonicality_resolved,true);
  assert.equal(resolution.effective_projection.case_status,'CASE_OPEN_NOT_ISSUED');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_BINDING.json'),'utf8')).reciprocal_binding.production_repository_acknowledgement_present,false);
});
test('changed authority boundaries, acknowledgement bytes and accepted merge are refused',()=>{
  const temp=fs.mkdtempSync(path.join(process.env.CINEMATICUM_TEST_TMPDIR||os.tmpdir(),'cinematicum-authority-test-'));
  try {
    fs.cpSync(path.join(root,'AUTHORITY'),path.join(temp,'AUTHORITY'),{recursive:true});
    const original=fs.readFileSync(path.join(temp,projection));
    for(const mutation of [r=>{r.effective_projection.case_status='ISSUED';},r=>{r.effective_projection.source_merge_authorized=true;},r=>{r.accepted_acknowledgement.accepted_merge_sha='0'.repeat(40);}]){
      const r=JSON.parse(original);mutation(r);fs.writeFileSync(path.join(temp,projection),JSON.stringify(r));assert.throws(()=>verifyAuthorityResolution(temp),/AUTHORITY_RESOLUTION_/);
    }
    fs.writeFileSync(path.join(temp,projection),original);fs.appendFileSync(path.join(temp,evidence),' ');assert.throws(()=>verifyAuthorityResolution(temp),/ACK_BYTES/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('live remote recheck requires the accepted merge ancestry and exact acknowledgement blob',async()=>{
  const ack=fs.readFileSync(path.join(root,evidence));
  const file={sha:'9bb05354c7ce88eeb1eb9f6b76e9b6ac00b3940d',encoding:'base64',content:ack.toString('base64')};
  const fetcher=async url=>new Response(JSON.stringify(String(url).includes('branches/main')?{commit:{sha:merge}}:file),{status:200});
  assert.equal((await recheckAcceptedAcknowledgement(fetcher)).main_sha,merge);
  await assert.rejects(()=>recheckAcceptedAcknowledgement(async url=>new Response(JSON.stringify(String(url).includes('branches/main')?{commit:{sha:'a'.repeat(40)}}:{status:'diverged',merge_base_commit:{sha:'b'.repeat(40)}}),{status:200})),/MERGE_NOT_ANCESTOR/);
  await assert.rejects(()=>recheckAcceptedAcknowledgement(async url=>new Response(JSON.stringify(String(url).includes('branches/main')?{commit:{sha:merge}}:{...file,content:Buffer.from('tampered').toString('base64')}),{status:200})),/REMOTE_ACK/);
});
