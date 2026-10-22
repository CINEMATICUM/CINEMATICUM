import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SCHEMA, ROLES, jsonBytes, sha256, digest, fileHash, contentIdentity, signedEnvelope,
  validatePackage, finalizeReceipt, capturePublicRelease, parseCanonical, inspectMedia, publicManifestURL, verifyFinalized } from '../scripts/final-release/core.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = fs.mkdtempSync(path.join(process.env.CINEMATICUM_TEST_TMPDIR || os.tmpdir(), 'cinematicum-final-release-tests-'));
const media = path.join(base, 'source'); fs.mkdirSync(media);
const video = { width: 64, height: 48, frames: 4, fps: { num: 4, den: 1 } };
const audio = { sample_rate: 48000, channels: 1, samples: 48000 };
const checked = (cmd, args) => {
  const p = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(p.status, 0, `${cmd} failed: ${p.stderr || p.error}`); return p;
};
checked('ffmpeg', ['-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=4:duration=1','-an','-c:v','ffv1','-threads','1',path.join(media,'picture.mkv')]);
checked('ffmpeg', ['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:a','pcm_s16le',path.join(media,'mix.wav')]);
checked('ffmpeg', ['-nostdin','-v','error','-i',path.join(media,'picture.mkv'),'-i',path.join(media,'mix.wav'),'-map','0:v:0','-map','1:a:0','-c','copy',path.join(media,'master.mkv')]);
let seq = 0;
function fixture() {
  const directory = path.join(base, `fixture-${++seq}`), root = path.join(directory, 'package'); fs.mkdirSync(root, {recursive:true});
  const producer = generateKeyPairSync('ed25519'), witness = generateKeyPairSync('ed25519');
  const keyID = key => sha256(createPublicKey(key).export({type:'spki',format:'der'}));
  const producerID = keyID(producer.privateKey), witnessID = keyID(witness.privateKey);
  const manifest = { schema: SCHEMA, case_id: 'ENGINE_TEST_FINAL_RELEASE', release_id:'ENGINE_TEST_RELEASE_1', test_fixture:true,
    objects:{}, assets:[], delivery_media_id:'master', approvals:[] };
  const write = (name, value) => { fs.writeFileSync(path.join(root,name), Buffer.isBuffer(value) ? value : jsonBytes(value)); return {path:name,public_name:name,...fileHash(path.join(root,name))}; };
  const add = (id, name, kind, expected) => {
    const a = { id,kind,file:{path:name,public_name:name,...fileHash(path.join(root,name))} }; if (expected) a.expected=expected;
    manifest.assets.push(a); return a;
  };
  fs.copyFileSync(path.join(media,'picture.mkv'),path.join(root,'take.mkv'));
  fs.copyFileSync(path.join(media,'picture.mkv'),path.join(root,'picture.mkv'));
  fs.copyFileSync(path.join(media,'mix.wav'),path.join(root,'mix.wav'));
  fs.copyFileSync(path.join(media,'master.mkv'),path.join(root,'master.mkv'));
  const take = add('take','take.mkv','media',{video}); add('picture','picture.mkv','media',{video});
  add('mix','mix.wav','media',{audio}); add('master','master.mkv','media',{video,audio});
  write('screenplay.txt',Buffer.from('ENGINE TEST ONLY. No cinematic or production approval.\n'));
  add('screenplay','screenplay.txt','document');
  write('provenance.json',{case_id:manifest.case_id,take_id:'TAKE_1',media_sha256:take.file.sha256,
    source_type:'LOCAL_PRODUCTION',paid_api_used:false,cloud_render_used:false,placeholder:false,
    method:'Synthetic FFmpeg test pattern; engine verification only',source_record:'tests/final-release.test.mjs'});
  add('provenance','provenance.json','document');
  function object(role, data) {
    manifest.objects[role] = write(`${role}.json`,{schema:SCHEMA,object_type:role,case_id:manifest.case_id,release_id:manifest.release_id,
      status:role==='authority'?'FINAL':'LOCKED',...data});
  }
  object('authority',{authorized_keys:ROLES.map(role=>({role,key_id:producerID}))});
  object('script',{script_asset_id:'screenplay'});
  object('shots',{script_sha256:manifest.objects.script.sha256,shots:[{id:'SHOT_1',function:'ENGINE TEST: verify decoded frame identity'}]});
  object('selection',{shots_sha256:manifest.objects.shots.sha256,takes:[{id:'TAKE_1',shot_id:'SHOT_1',media_id:'take',provenance_asset_id:'provenance'}]});
  object('timeline',{selection_sha256:manifest.objects.selection.sha256,fps:video.fps,frame_count:video.frames,picture_media_id:'picture',
    segments:[{take_id:'TAKE_1',source_in_frame:0,duration_frames:4,timeline_in_frame:0}]});
  object('sound',{timeline_sha256:manifest.objects.timeline.sha256,media_id:'mix'});
  object('grade',{timeline_sha256:manifest.objects.timeline.sha256,picture_sha256:manifest.assets.find(a=>a.id==='picture').file.sha256});
  const policyPath = path.join(directory,'trust.json');
  const policy = {schema:'cinematicum-release-trust-v1',case_id:manifest.case_id,test_fixture:true,keys:[
    {key_id:producerID,principal_id:'ENGINE_TEST_PRODUCER',public_key:producer.publicKey.export({type:'spki',format:'pem'}),roles:[...ROLES,'issuer']},
    {key_id:witnessID,principal_id:'ENGINE_TEST_WITNESS',public_key:witness.publicKey.export({type:'spki',format:'pem'}),roles:['replay']} ]};
  fs.writeFileSync(policyPath,jsonBytes(policy));
  const p = (role,kind,subject,extra={}) => ({schema:SCHEMA,kind,role,decision:'APPROVE',case_id:manifest.case_id,release_id:manifest.release_id,
    subject_sha256:subject,test_fixture:manifest.test_fixture,signed_at:new Date().toISOString(),...extra});
  const save = () => fs.writeFileSync(path.join(root,'manifest.json'),jsonBytes(manifest));
  const resign = () => {
    manifest.approvals=[];
    for(const role of ROLES) {
      const extra=role==='director'?{audience_review:Object.fromEntries(['image','sound','silence','performance','rhythm','cut','audience_experience'].map(k=>[k,'ACCEPTED']))}:{};
      manifest.approvals.push({role,file:write(`approval-${role}.json`,signedEnvelope(p(role,'PRODUCTION_APPROVAL',contentIdentity(manifest),extra),producer.privateKey))});
    }
    save();
  };
  resign();
  const mutateObject = (role, change) => { const o=JSON.parse(fs.readFileSync(path.join(root,`${role}.json`),'utf8')); change(o); manifest.objects[role]=write(`${role}.json`,o); };
  return {root,directory,manifest,producer,witness,producerID,witnessID,policyPath,policy,write,save,resign,p,mutateObject};
}
async function prepared(f) {
  const validation=await validatePackage(f.root,f.policyPath),bytes=jsonBytes(validation.report); fs.writeFileSync(path.join(f.root,'PREPARATION.json'),bytes);
  const replay=signedEnvelope(f.p('replay','INDEPENDENT_PUBLIC_REPLAY',sha256(bytes),{manifest_sha256:validation.report.manifest_sha256,
    content_sha256:validation.report.content_sha256,all_media_decoded:true,public_manifest_url:'https://github.com/CINEMATICUM/CINEMATICUM/releases/download/engine-test/manifest.json',public_capture:{sha256:digest({engine_test_only:true})}}),f.witness.privateKey);
  const issuer=signedEnvelope(f.p('issuer','ISSUANCE_AUTHORIZATION',digest({preparation_sha256:sha256(bytes),replay_sha256:digest(replay)})),f.producer.privateKey);
  return {validation,bytes,replay,issuer};
}
function refuse(pattern) { return error => { assert.match(error.message,pattern); return true; }; }

test('real FFV1/PCM package decodes and signs without issuing an engine fixture',async()=>{
  const f=fixture(),p=await prepared(f),receipt=finalizeReceipt(p.validation,p.bytes,p.replay,p.issuer);
  assert.equal(receipt.status,'TEST_FIXTURE_ACCEPTED_NOT_ISSUED'); assert.equal(receipt.claims.proves_admissibility,false);
  assert.equal(receipt.claims.proves_film_issued,false); assert.equal(p.validation.report.measurements.master.video.frames,4);
  assert.equal(p.validation.report.measurements.master.audio.samples,48000);
  assert.deepEqual(p.validation.report.measurements.master.audio,p.validation.report.measurements.mix.audio);
});
test('full CLI prepares, finalizes and refuses overwrite',async()=>{
  const f=fixture(),p=await prepared(f); fs.unlinkSync(path.join(f.root,'PREPARATION.json'));
  checked(process.execPath,['scripts/final-release.mjs','prepare','--package',f.root,'--trust',f.policyPath]);
  const replay=path.join(f.directory,'replay.json'),authorization=path.join(f.directory,'authorization.json'),out=path.join(f.directory,'final');
  fs.writeFileSync(replay,jsonBytes(p.replay)); fs.writeFileSync(authorization,jsonBytes(p.issuer));
  checked(process.execPath,['scripts/final-release.mjs','finalize','--package',f.root,'--trust',f.policyPath,'--replay',replay,'--authorization',authorization,'--out',out]);
  assert.equal(readFinal('FINAL_ISSUANCE_RECEIPT.json').claims.proves_admissibility,false); assert.ok(readFinal('COMMITTED.json').files.length>=6);
  function readFinal(name) { return JSON.parse(fs.readFileSync(path.join(out,name),'utf8')); }
  const rerun=spawnSync(process.execPath,['scripts/final-release.mjs','prepare','--package',f.root,'--trust',f.policyPath],{encoding:'utf8'});
  assert.equal(rerun.status,1); assert.equal(fileHash(path.join(f.root,'PREPARATION.json')).sha256,sha256(p.bytes));
  checked(process.execPath,['scripts/final-release.mjs','verify-final','--package',f.root,'--trust',f.policyPath,'--finalized',out]);
  const marker=readFinal('COMMITTED.json'),receipt=readFinal('FINAL_ISSUANCE_RECEIPT.json');
  receipt.status='ISSUED_ADMISSIBLE_MOTION_PICTURE';fs.writeFileSync(path.join(out,'FINAL_ISSUANCE_RECEIPT.json'),jsonBytes(receipt));
  assert.throws(()=>verifyFinalized(p.validation,out),refuse(/COMMIT_CONTENT/));
  Object.assign(marker.files.find(item=>item.name==='FINAL_ISSUANCE_RECEIPT.json'),fileHash(path.join(out,'FINAL_ISSUANCE_RECEIPT.json')));
  fs.writeFileSync(path.join(out,'COMMITTED.json'),jsonBytes(marker));
  assert.throws(()=>verifyFinalized(p.validation,out),refuse(/FINAL_RECEIPT_CHANGED/));
});
test('actual public-capture workflow uses all downloaded bytes and fails on a missing asset',async()=>{
  const f=fixture(),p=await prepared(f),map=new Map([['manifest.json',fs.readFileSync(path.join(f.root,'manifest.json'))],['PREPARATION.json',p.bytes]]);
  for(const ref of [...Object.values(f.manifest.objects),...f.manifest.assets.map(a=>a.file),...f.manifest.approvals.map(a=>a.file)]) map.set(ref.public_name,fs.readFileSync(path.join(f.root,ref.path)));
  const calls=[];
  const fetcher=async(url,options)=>{calls.push(options); const data=map.get(new URL(url).pathname.split('/').pop());return new Response(data||'',{status:data?200:404});};
  const out=path.join(f.directory,'capture'); const c=await capturePublicRelease(p.replay.payload.public_manifest_url,out,fetcher);
  assert.equal(c.authentication_used,false); assert.ok(calls.every(o=>o.credentials==='omit'&&!o.headers.Authorization));
  assert.deepEqual((await validatePackage(out,f.policyPath)).report,p.validation.report);
  map.delete('take.mkv');
  const missing=path.join(f.directory,'capture-missing'); await assert.rejects(()=>capturePublicRelease(p.replay.payload.public_manifest_url,missing,fetcher),refuse(/PUBLIC_DOWNLOAD_FAILED/));
  assert.ok(fs.existsSync(path.join(missing,'CAPTURE_FAILURE.json'))); assert.ok(!fs.existsSync(path.join(missing,'INDEPENDENT_REPLAY.json')));
});
test('capture rejects remote substitution and unsafe redirect',async()=>{
  const f=fixture(); const releaseURL='https://github.com/CINEMATICUM/CINEMATICUM/releases/download/test/manifest.json';
  await assert.rejects(()=>capturePublicRelease(releaseURL,path.join(f.directory,'redirect'),async()=>new Response('',{status:302,headers:{Location:'http://127.0.0.1/secrets'}})),refuse(/REDIRECT_HOST/));
  const bad=async(url)=>new Response(new URL(url).pathname.endsWith('manifest.json')?fs.readFileSync(path.join(f.root,'manifest.json')):'tampered',{status:200});
  await assert.rejects(()=>capturePublicRelease(releaseURL,path.join(f.directory,'tamper'),bad),refuse(/PUBLIC_HASH_MISMATCH/));
  assert.throws(()=>publicManifestURL('https://github.com/CINEMATICUM/CINEMATICUM/releases/download/test/manifest.json?token=secret'),refuse(/PUBLIC_RELEASE_URL/));
});
test('missing approval, changed source, forged signature and stale approval are refused',async()=>{
  for(const mode of ['missing','source','signature','stale']) {
    const f=fixture();
    if(mode==='missing'){f.manifest.approvals.pop();f.save();}
    if(mode==='source')fs.appendFileSync(path.join(f.root,'take.mkv'),'tamper');
    if(mode==='signature'){const a=f.manifest.approvals[0],o=JSON.parse(fs.readFileSync(path.join(f.root,a.file.path),'utf8'));o.signature=Buffer.alloc(64).toString('base64');a.file=f.write(a.file.path,o);f.save();}
    if(mode==='stale'){f.manifest.release_id='ENGINE_TEST_CHANGED_RELEASE';f.save();}
    await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/MANIFEST_COUNTS|CONTENT_MISMATCH|SIGNATURE_INVALID|OBJECT_BINDING|ATTESTATION_BINDING/));
  }
});
test('no selections, foreign take, timeline gaps and invalid ranges fail before any approval',async()=>{
  for(const [mode,change] of [
    ['selection',o=>{o.takes=[];}],['selection',o=>{o.takes[0].shot_id='NOT_LOCKED';}],
    ['timeline',o=>{o.segments[0].timeline_in_frame=1;}],['timeline',o=>{o.segments[0].duration_frames=5;}]
  ]){
    const f=fixture();f.mutateObject(mode,change);
    if(mode==='selection')f.mutateObject('timeline',o=>{o.selection_sha256=f.manifest.objects.selection.sha256;});
    f.resign();await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/NO_SELECTED_TAKES|TAKE_SHOT|TIMELINE_RANGE/));
  }
});
test('foreign case, cloud provenance, unbound asset and incomplete audience review are refused',async()=>{
  for(const mode of ['case','provenance','unbound','audience']){
    const f=fixture();
    if(mode==='case'){f.mutateObject('authority',o=>{o.case_id='WRONG_CASE';});f.resign();}
    if(mode==='provenance'){const p=JSON.parse(fs.readFileSync(path.join(f.root,'provenance.json'),'utf8'));p.cloud_render_used=true;f.manifest.assets.find(a=>a.id==='provenance').file=f.write('provenance.json',p);f.resign();}
    if(mode==='unbound'){f.manifest.assets.push({id:'unused',kind:'document',file:f.write('unused.txt',Buffer.from('unbound'))});f.resign();}
    if(mode==='audience'){const a=f.manifest.approvals[0],o=JSON.parse(fs.readFileSync(path.join(f.root,a.file.path),'utf8'));delete o.payload.audience_review.cut;a.file=f.write(a.file.path,signedEnvelope(o.payload,f.producer.privateKey));f.save();}
    await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/OBJECT_BINDING|TAKE_PROVENANCE|UNBOUND_ASSET|AUDIENCE_REVIEW/));
  }
});
test('external trust cannot be supplied by an untrusted media package or same-principal witness',async()=>{
  const f=fixture();fs.copyFileSync(f.policyPath,path.join(f.root,'trust.json'));
  await assert.rejects(()=>validatePackage(f.root,path.join(f.root,'trust.json')),refuse(/TRUST_INSIDE_PACKAGE/));
  f.policy.keys[1].principal_id=f.policy.keys[0].principal_id;fs.writeFileSync(f.policyPath,jsonBytes(f.policy));
  await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/REPLAY_NOT_INDEPENDENT/));
});
test('traversal, duplicate public names, symlinks and duplicate JSON keys are refused',async()=>{
  const traversal=fixture();traversal.manifest.assets[0].file.path='../outside';traversal.save();await assert.rejects(()=>validatePackage(traversal.root,traversal.policyPath),refuse(/UNSAFE_PATH/));
  const duplicate=fixture();duplicate.manifest.assets[1].file.public_name=duplicate.manifest.assets[0].file.public_name;duplicate.save();await assert.rejects(()=>validatePackage(duplicate.root,duplicate.policyPath),refuse(/DUPLICATE/));
  const link=fixture();fs.unlinkSync(path.join(link.root,'take.mkv'));fs.symlinkSync(path.join(media,'picture.mkv'),path.join(link.root,'take.mkv'));await assert.rejects(()=>validatePackage(link.root,link.policyPath),refuse(/SYMLINK_REFUSED/));
  assert.throws(()=>parseCanonical(Buffer.from('{"a":1,"a":2}\n'),'duplicate'),refuse(/NON_CANONICAL_JSON/));
});
test('actual media dimensions, frame counts, audio absence and sample counts are checked',async()=>{
  await assert.rejects(()=>inspectMedia(path.join(media,'picture.mkv'),{video:{...video,width:32}}),refuse(/VIDEO_DIMENSIONS/));
  await assert.rejects(()=>inspectMedia(path.join(media,'picture.mkv'),{video:{...video,frames:5}}),refuse(/VIDEO_FRAME_COUNT/));
  await assert.rejects(()=>inspectMedia(path.join(media,'picture.mkv'),{video,audio}),refuse(/STREAM_LAYOUT/));
  await assert.rejects(()=>inspectMedia(path.join(media,'mix.wav'),{audio:{...audio,samples:47999}}),refuse(/AUDIO_SAMPLE_COUNT/));
});
test('same-duration replacement mix cannot masquerade as the mastered delivery',async()=>{
  const f=fixture();fs.unlinkSync(path.join(f.root,'mix.wav'));
  checked('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=1','-c:a','pcm_s16le',path.join(f.root,'mix.wav')]);
  f.manifest.assets.find(a=>a.id==='mix').file={path:'mix.wav',public_name:'mix.wav',...fileHash(path.join(f.root,'mix.wav'))};f.resign();
  await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/DELIVERY_MIX_MISMATCH/));
});
test('stale preparation, wrong witness, changed replay and unsupported public URL cannot issue',async()=>{
  const f=fixture(),p=await prepared(f);
  const changed=structuredClone(p.validation.report);changed.measurements.master.video.frames=5;
  assert.throws(()=>finalizeReceipt(p.validation,jsonBytes(changed),p.replay,p.issuer),refuse(/PREPARATION_STALE/));
  assert.throws(()=>finalizeReceipt(p.validation,p.bytes,signedEnvelope(p.replay.payload,f.producer.privateKey),p.issuer),refuse(/UNTRUSTED_ROLE/));
  const replay=structuredClone(p.replay);replay.payload.all_media_decoded=false;
  assert.throws(()=>finalizeReceipt(p.validation,p.bytes,signedEnvelope(replay.payload,f.witness.privateKey),p.issuer),refuse(/REPLAY_BINDING/));
  replay.payload.all_media_decoded=true;replay.payload.public_manifest_url='http://localhost/manifest.json';
  assert.throws(()=>finalizeReceipt(p.validation,p.bytes,signedEnvelope(replay.payload,f.witness.privateKey),p.issuer),refuse(/PUBLIC_RELEASE_URL/));
});
test('test-scope switch cannot turn fixtures into production issuance',async()=>{
  const f=fixture();f.manifest.test_fixture=false;f.save();await assert.rejects(()=>validatePackage(f.root,f.policyPath),refuse(/TEST_SCOPE/));
});
test.after(()=>fs.rmSync(base,{recursive:true,force:true}));
