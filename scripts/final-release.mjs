#!/usr/bin/env node
// Separate, fail-closed final-film workflow. Historical compiler records are never rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { SCHEMA, ROLES, requireThat, parseCanonical, contentIdentity, signedEnvelope,
  verifyEnvelope, validatePackage, exclusiveJson, preparationMatches, finalizeReceipt,
  verifyReplay, capturePublicRelease, sha256, digest, fileHash, contained, terminalClosure, verifyFinalized } from './final-release/core.mjs';

const command = process.argv[2];
const options = {};
for (let i = 3; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  requireThat(/^--[a-z-]+$/.test(key) && value && !value.startsWith('--') && !options[key.slice(2)], 'ARGUMENTS');
  options[key.slice(2)] = value;
}
const required = name => { requireThat(options[name], 'ARGUMENT_REQUIRED', name); return options[name]; };
function allow(names) { requireThat(Object.keys(options).every(key => names.includes(key)), 'UNKNOWN_ARGUMENT'); }
function read(filename) { fileHash(filename, 2 * 1024 * 1024); return parseCanonical(fs.readFileSync(filename), filename); }
function privateKey(filename) {
  fileHash(filename, 16384);
  const stat = fs.statSync(filename); requireThat((stat.mode & 0o077) === 0, 'PRIVATE_KEY_PERMISSIONS', 'owner-only permissions required');
  return createPrivateKey(fs.readFileSync(filename));
}
function payload(manifest, role, kind, subject) {
  return { schema: SCHEMA, kind, role, decision: 'REVIEW_REQUIRED', case_id: manifest.case_id,
    release_id: manifest.release_id, subject_sha256: subject, test_fixture: manifest.test_fixture,
    signed_at: new Date().toISOString() };
}
function prepBytes(root) { return fs.readFileSync(contained(root, 'PREPARATION.json')); }
function result(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

try {
  if (command === 'verify' || command === 'prepare') {
    allow(['package', 'trust']);
    const root = path.resolve(required('package'));
    if (command === 'prepare') requireThat(!fs.existsSync(path.join(root,'PREPARATION.json')), 'OUTPUT_EXISTS');
    const validation = await validatePackage(root, required('trust'));
    if (command === 'prepare') exclusiveJson(path.join(root, 'PREPARATION.json'), validation.report);
    result(validation.report);
  } else if (command === 'approval-payload') {
    allow(['package', 'role', 'out']);
    const manifest = read(contained(required('package'), 'manifest.json')), role = required('role');
    requireThat(ROLES.includes(role), 'PRODUCTION_ROLE');
    const p = payload(manifest, role, 'PRODUCTION_APPROVAL', contentIdentity(manifest));
    if (role === 'director') p.audience_review = Object.fromEntries(['image','sound','silence','performance','rhythm','cut','audience_experience'].map(k => [k, 'REVIEW_REQUIRED']));
    exclusiveJson(required('out'), p);
    result({ status: 'UNSIGNED_REVIEW_REQUIRED', file: options.out, claims: { proves_admissibility: false } });
  } else if (command === 'sign') {
    allow(['payload', 'key', 'out']);
    const p = read(required('payload'));
    requireThat(p.schema === SCHEMA && p.decision === 'APPROVE' && [...ROLES, 'issuer'].includes(p.role) && ['PRODUCTION_APPROVAL','ISSUANCE_AUTHORIZATION'].includes(p.kind), 'EXPLICIT_APPROVAL_REQUIRED');
    requireThat((p.role === 'issuer') === (p.kind === 'ISSUANCE_AUTHORIZATION'), 'APPROVAL_ROLE_KIND');
    requireThat(p.role !== 'director' || ['image','sound','silence','performance','rhythm','cut','audience_experience'].every(k => p.audience_review?.[k] === 'ACCEPTED'), 'AUDIENCE_REVIEW_REQUIRED');
    requireThat(Date.parse(p.signed_at) <= Date.now() && Date.parse(p.signed_at) >= Date.now() - 24 * 3600 * 1000, 'REVIEW_TIMESTAMP');
    exclusiveJson(required('out'), signedEnvelope(p, privateKey(required('key'))));
    result({ status: 'EXPLICIT_DECISION_SIGNED', file: options.out });
  } else if (command === 'replay') {
    allow(['manifest-url', 'out', 'trust', 'key']);
    const destination = path.resolve(required('out'));
    const capture = await capturePublicRelease(required('manifest-url'), destination);
    const validation = await validatePackage(destination, required('trust'));
    const bytes = prepBytes(destination); preparationMatches(parseCanonical(bytes, 'preparation'), validation.report);
    const p = { ...payload(validation.manifest, 'replay', 'INDEPENDENT_PUBLIC_REPLAY', sha256(bytes)),
      decision: 'APPROVE', manifest_sha256: validation.report.manifest_sha256, content_sha256: validation.report.content_sha256,
      all_media_decoded: true, public_manifest_url: options['manifest-url'], public_capture: { sha256: digest(capture) } };
    const envelope = signedEnvelope(p, privateKey(required('key')));
    verifyEnvelope(envelope, validation.policy, validation.manifest, 'replay', sha256(bytes), 'INDEPENDENT_PUBLIC_REPLAY');
    verifyReplay(validation, bytes, envelope);
    exclusiveJson(path.join(destination, 'INDEPENDENT_REPLAY.json'), envelope);
    result({ status: 'INDEPENDENT_REPLAY_VERIFIED', file: path.join(destination, 'INDEPENDENT_REPLAY.json'), proves_admissibility: false });
  } else if (command === 'issuance-payload') {
    allow(['package', 'trust', 'replay', 'out']);
    const root = path.resolve(required('package')), validation = await validatePackage(root, required('trust'));
    const verified = verifyReplay(validation, prepBytes(root), read(required('replay')));
    exclusiveJson(required('out'), payload(validation.manifest, 'issuer', 'ISSUANCE_AUTHORIZATION', verified.decisionSubject));
    result({ status: 'UNSIGNED_ISSUANCE_REVIEW_REQUIRED', file: options.out });
  } else if (command === 'finalize') {
    allow(['package', 'trust', 'replay', 'authorization', 'out']);
    const root = path.resolve(required('package')), validation = await validatePackage(root, required('trust'));
    const bytes = prepBytes(root), replay = read(required('replay')), authorization = read(required('authorization'));
    const receipt = finalizeReceipt(validation, bytes, replay, authorization), out = path.resolve(required('out'));
    requireThat(!fs.existsSync(out), 'OUTPUT_EXISTS');
    fileHash(contained(root, 'manifest.json')); // Recheck package presence immediately before publication.
    fs.mkdirSync(out, { mode: 0o700 });
    exclusiveJson(path.join(out, 'PREPARATION.json'), parseCanonical(bytes, 'preparation'));
    exclusiveJson(path.join(out, 'INDEPENDENT_REPLAY.json'), replay);
    exclusiveJson(path.join(out, 'ISSUANCE_AUTHORIZATION.json'), authorization);
    exclusiveJson(path.join(out, 'RELEASE_MANIFEST.json'), validation.manifest);
    exclusiveJson(path.join(out, 'FINAL_ISSUANCE_RECEIPT.json'), receipt);
    exclusiveJson(path.join(out, 'TERMINAL_CLOSURE.json'), terminalClosure(receipt));
    // COMMITTED is the final file. Partial output from a failure has no valid commit marker.
    exclusiveJson(path.join(out, 'COMMITTED.json'), { schema: SCHEMA, kind: 'FINAL_RELEASE_COMMIT',
      case_id: receipt.case_id, release_id: receipt.release_id, test_fixture: receipt.test_fixture,
      files: fs.readdirSync(out).sort().map(name => ({ name, ...fileHash(path.join(out, name)) })) });
    result({ status: receipt.status, directory: out, receipt_sha256: digest(receipt), repository_case_projection_updated: false });
  } else if (command === 'verify-final') {
    allow(['package','trust','finalized']);
    const validation = await validatePackage(required('package'), required('trust'));
    const receipt = verifyFinalized(validation, required('finalized'));
    result({status:'FINAL_RECORD_VERIFIED',case_id:receipt.case_id,release_id:receipt.release_id,issuance_status:receipt.status,claims:receipt.claims});
  } else {
    throw new Error('COMMAND_REQUIRED: verify | prepare | approval-payload | sign | replay | issuance-payload | finalize | verify-final');
  }
} catch (error) {
  process.stderr.write(`FINAL_RELEASE_REFUSED=${String(error.message).slice(0, 2048)}\n`);
  process.exitCode = 1;
}
