import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'cinematicum-final-release-v1';
export const ROLES = ['director', 'editor', 'sound', 'color', 'release'];
const OBJECTS = ['authority', 'script', 'shots', 'selection', 'timeline', 'sound', 'grade'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const MAX_JSON = 2 * 1024 * 1024;
const MAX_MEDIA = 64 * 1024 ** 3;
const PUBLIC_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/;
const AUDIENCE = ['image', 'sound', 'silence', 'performance', 'rhythm', 'cut', 'audience_experience'];

export function requireThat(condition, code, detail = '') {
  if (!condition) { const error = new Error(`${code}${detail ? ': ' + detail : ''}`); error.code = code; throw error; }
}
export function stable(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') { requireThat(Number.isSafeInteger(value), 'UNSAFE_NUMBER'); return value; }
  if (Array.isArray(value)) return value.map(stable);
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_JSON_VALUE');
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
export const canonical = value => JSON.stringify(stable(value));
export const jsonBytes = value => Buffer.from(JSON.stringify(stable(value), null, 2) + '\n');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha256(Buffer.from(canonical(value)));
export function parseCanonical(bytes, label) {
  requireThat(bytes.length <= MAX_JSON, 'JSON_TOO_LARGE', label);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { requireThat(false, 'INVALID_JSON', label); }
  requireThat(jsonBytes(value).equals(bytes), 'NON_CANONICAL_JSON', label);
  return value;
}
function integer(value, min, max, label) { requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'INTEGER_RANGE', label); }
function identifier(value, label) { requireThat(typeof value === 'string' && ID.test(value), 'INVALID_IDENTIFIER', label); }
function exactKeys(value, allowed, label) {
  requireThat(value && !Array.isArray(value) && typeof value === 'object', 'OBJECT_REQUIRED', label);
  requireThat(Object.keys(value).every(key => allowed.includes(key)), 'UNKNOWN_FIELD', label);
}
function unique(values, label) { requireThat(new Set(values).size === values.length, 'DUPLICATE', label); }
function fraction(value, label) {
  exactKeys(value, ['num', 'den'], label); integer(value.num, 1, 1000000, label); integer(value.den, 1, 1000000, label);
  requireThat(value.num / value.den <= 240, 'FRAME_RATE_RANGE', label);
}
function sameRate(a, b) { return BigInt(a.num) * BigInt(b.den) === BigInt(b.num) * BigInt(a.den); }
function noSymlinks(absolute) {
  const resolved = path.resolve(absolute); let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    requireThat(!fs.lstatSync(current).isSymbolicLink(), 'SYMLINK_REFUSED', current);
  }
  return resolved;
}
export function contained(root, relative) {
  requireThat(typeof relative === 'string' && relative.length > 0 && relative.length < 512 && !relative.includes('\\') && !path.isAbsolute(relative), 'UNSAFE_PATH');
  requireThat(relative.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\0')), 'UNSAFE_PATH', relative);
  const absolute = path.resolve(root, relative);
  requireThat(absolute.startsWith(path.resolve(root) + path.sep), 'PATH_ESCAPE', relative);
  return noSymlinks(absolute);
}
export function fileHash(absolute, max = MAX_MEDIA) {
  noSymlinks(absolute);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd); requireThat(before.isFile() && before.size > 0 && before.size <= max, 'FILE_BOUNDS', absolute);
    const h = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024); let total = 0, length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) { total += length; requireThat(total <= max, 'FILE_BOUNDS', absolute); h.update(buffer.subarray(0, length)); }
    const after = fs.fstatSync(fd);
    requireThat(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs && total === before.size, 'FILE_CHANGED', absolute);
    return { sha256: h.digest('hex'), size_bytes: total };
  } finally { fs.closeSync(fd); }
}
function descriptor(value, label) {
  exactKeys(value, ['path', 'public_name', 'sha256', 'size_bytes'], label);
  requireThat(HASH.test(value.sha256), 'INVALID_HASH', label); integer(value.size_bytes, 1, MAX_MEDIA, label);
  requireThat(PUBLIC_NAME.test(value.public_name) && value.public_name !== 'manifest.json' && value.public_name !== 'PREPARATION.json', 'INVALID_PUBLIC_NAME', label);
}
function boundFile(root, record, label, inventory) {
  descriptor(record, label); const absolute = contained(root, record.path), identity = fileHash(absolute);
  requireThat(identity.sha256 === record.sha256 && identity.size_bytes === record.size_bytes, 'CONTENT_MISMATCH', label);
  inventory.push({ path: record.path, ...identity }); return absolute;
}
function record(root, ref, label, inventory) {
  requireThat(ref.size_bytes <= MAX_JSON, 'JSON_TOO_LARGE', label);
  const absolute = boundFile(root, ref, label, inventory);
  const bytes = fs.readFileSync(absolute); requireThat(sha256(bytes) === ref.sha256 && bytes.length === ref.size_bytes, 'CONTENT_CHANGED', label);
  return parseCanonical(bytes, label);
}
function context(record, manifest, type, status) {
  requireThat(record.schema === SCHEMA && record.object_type === type && record.case_id === manifest.case_id && record.release_id === manifest.release_id && record.status === status, 'OBJECT_BINDING', type);
}
export function contentIdentity(manifest) {
  return digest({ schema: manifest.schema, case_id: manifest.case_id, release_id: manifest.release_id, test_fixture: manifest.test_fixture, objects: manifest.objects, assets: manifest.assets, delivery_media_id: manifest.delivery_media_id });
}
export function loadPolicy(policyPath, packageRoot) {
  const absolute = noSymlinks(policyPath);
  requireThat(!absolute.startsWith(path.resolve(packageRoot) + path.sep) && absolute !== path.resolve(packageRoot), 'TRUST_INSIDE_PACKAGE');
  const identity = fileHash(absolute, MAX_JSON), bytes = fs.readFileSync(absolute);
  requireThat(sha256(bytes) === identity.sha256, 'POLICY_CHANGED');
  const value = parseCanonical(bytes, 'trust policy');
  exactKeys(value, ['schema', 'case_id', 'test_fixture', 'keys'], 'trust policy');
  requireThat(value.schema === 'cinematicum-release-trust-v1' && typeof value.test_fixture === 'boolean' && Array.isArray(value.keys) && value.keys.length >= 2 && value.keys.length <= 32, 'TRUST_POLICY');
  identifier(value.case_id, 'trust case'); const keys = new Map();
  for (const item of value.keys) {
    exactKeys(item, ['key_id', 'principal_id', 'public_key', 'roles'], 'trust key'); identifier(item.principal_id, 'principal');
    const key = createPublicKey(item.public_key); requireThat(key.asymmetricKeyType === 'ed25519', 'KEY_TYPE');
    requireThat(item.key_id === sha256(key.export({ type: 'spki', format: 'der' })), 'KEY_ID');
    requireThat(!keys.has(item.key_id) && Array.isArray(item.roles) && item.roles.length > 0 && item.roles.every(role => [...ROLES, 'issuer', 'replay'].includes(role)), 'KEY_ROLES'); unique(item.roles, 'roles');
    keys.set(item.key_id, { ...item, key });
  }
  const producers = new Set(value.keys.filter(k => k.roles.some(r => r !== 'replay')).map(k => k.principal_id));
  requireThat(value.keys.filter(k => k.roles.includes('replay')).every(k => k.roles.length === 1 && !producers.has(k.principal_id)), 'REPLAY_NOT_INDEPENDENT');
  return { ...value, keys, sha256: identity.sha256, path: absolute };
}
export function signedEnvelope(payload, privateKey) {
  const publicKey = createPublicKey(privateKey); requireThat(publicKey.asymmetricKeyType === 'ed25519', 'KEY_TYPE');
  return { payload, key_id: sha256(publicKey.export({ type: 'spki', format: 'der' })), signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
export function verifyEnvelope(envelope, policy, manifest, role, subject, kind) {
  exactKeys(envelope, ['payload', 'key_id', 'signature'], 'signed envelope');
  const key = policy.keys.get(envelope.key_id); requireThat(key && key.roles.includes(role), 'UNTRUSTED_ROLE', role);
  const p = envelope.payload;
  requireThat(p && p.schema === SCHEMA && p.kind === kind && p.role === role && p.decision === 'APPROVE' && p.case_id === manifest.case_id && p.release_id === manifest.release_id && p.subject_sha256 === subject && p.test_fixture === manifest.test_fixture, 'ATTESTATION_BINDING', role);
  requireThat(typeof p.signed_at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.signed_at) && Number.isFinite(Date.parse(p.signed_at)) && new Date(p.signed_at).toISOString() === p.signed_at && Date.parse(p.signed_at) <= Date.now() + 300000, 'ATTESTATION_TIME');
  const signature = Buffer.from(envelope.signature || '', 'base64');
  requireThat(signature.length === 64 && signature.toString('base64') === envelope.signature && verify(null, Buffer.from(canonical(p)), key.key, signature), 'SIGNATURE_INVALID', role);
  return { key_id: envelope.key_id, principal_id: key.principal_id, role, signed_at: p.signed_at };
}
async function child(command, args, onLine, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '', pending = '', bytes = 0, failure;
    const stop = error => { if (failure) return; failure = error; process.kill('SIGTERM'); setTimeout(() => process.kill('SIGKILL'), 500).unref(); };
    const timer = setTimeout(() => stop(new Error('DECODER_TIMEOUT')), 120000);
    process.stdout.on('data', data => {
      bytes += data.length;
      if (!onLine && bytes > maxBytes) return stop(new Error('DECODER_OUTPUT_LIMIT'));
      if (!onLine) { stdout += data.toString('utf8'); return; }
      pending += data.toString('utf8'); if (pending.length > 65536 && !pending.includes('\n')) return stop(new Error('DECODER_LINE_LIMIT'));
      let at; while ((at = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, at); pending = pending.slice(at + 1); try { onLine(line); } catch (error) { stop(error); } }
    });
    process.stderr.on('data', data => { stderr += data.toString('utf8'); if (stderr.length > 65536) stop(new Error('DECODER_DIAGNOSTIC_LIMIT')); });
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('close', code => { clearTimeout(timer); if (onLine && pending.trim()) { try { onLine(pending); } catch (error) { failure ||= error; } } if (failure) reject(failure); else if (code !== 0) reject(new Error(`DECODER_FAILED ${command}: ${stderr.slice(-2048)}`)); else resolve(stdout); });
  });
}
export async function inspectMedia(filename, expected) {
  exactKeys(expected, ['video', 'audio'], 'expected media'); requireThat(expected.video || expected.audio, 'EMPTY_MEDIA_EXPECTATION');
  const probe = JSON.parse(await child('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', filename]));
  const videos = probe.streams.filter(s => s.codec_type === 'video'), audios = probe.streams.filter(s => s.codec_type === 'audio');
  requireThat(probe.streams.length === videos.length + audios.length && videos.length === (expected.video ? 1 : 0) && audios.length === (expected.audio ? 1 : 0), 'STREAM_LAYOUT');
  const result = {};
  for (const kind of ['video', 'audio']) {
    const e = expected[kind]; if (!e) continue; const stream = (kind === 'video' ? videos : audios)[0];
    if (kind === 'video') {
      exactKeys(e, ['width', 'height', 'frames', 'fps'], 'video'); integer(e.width, 1, 16384, 'width'); integer(e.height, 1, 16384, 'height'); integer(e.frames, 1, 500000, 'frames'); fraction(e.fps, 'fps');
      requireThat(e.width * e.height <= 33554432 && stream.width === e.width && stream.height === e.height, 'VIDEO_DIMENSIONS');
      const [num, den] = stream.avg_frame_rate.split('/').map(Number); requireThat(num > 0 && den > 0 && sameRate({ num, den }, e.fps), 'VIDEO_RATE');
    } else {
      exactKeys(e, ['sample_rate', 'channels', 'samples'], 'audio'); integer(e.sample_rate, 8000, 192000, 'sample rate'); integer(e.channels, 1, 32, 'channels'); integer(e.samples, 1, 192000 * 3600, 'samples');
      requireThat(Number(stream.sample_rate) === e.sample_rate && stream.channels === e.channels, 'AUDIO_LAYOUT');
    }
    let count = 0, units = 0, timebase, nextPTS = 0; const h = createHash('sha256');
    await child('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-threads', '1', '-copyts', '-protocol_whitelist', 'file,pipe', '-i', filename, '-map', kind === 'video' ? '0:v:0' : '0:a:0', ...(kind === 'video' ? ['-an', '-fps_mode', 'passthrough', '-c:v', 'rawvideo', '-pix_fmt', 'rgba64le', '-threads:v', '1'] : ['-vn', '-af', 'asetnsamples=n=1024:p=0', '-c:a', 'pcm_s32le']), '-f', 'framehash', '-hash', 'sha256', '-'], line => {
      if (line.startsWith('#tb 0: ')) { const [num, den] = line.slice(7).trim().split('/').map(Number); timebase = { num, den }; return; }
      if (!line || line.startsWith('#')) return;
      const cells = line.split(',').map(x => x.trim()); requireThat(cells.length === 6 && cells[0] === '0' && HASH.test(cells[5]), 'DECODE_FORMAT');
      const pts = Number(cells[2]), duration = Number(cells[3]), size = Number(cells[4]);
      requireThat(Number.isSafeInteger(pts) && pts === nextPTS && Number.isSafeInteger(duration) && duration > 0 && Number.isSafeInteger(size) && size > 0, 'MEDIA_TIMESTAMPS');
      count++; units += duration; nextPTS += duration; h.update(`${size}:${cells[5]}\n`);
      requireThat(count <= 500000 && units <= 192000 * 3600, 'DECODE_LIMIT');
      if (kind === 'video') requireThat(timebase && BigInt(duration) * BigInt(timebase.num) * BigInt(e.fps.num) === BigInt(timebase.den) * BigInt(e.fps.den), 'VARIABLE_FRAME_RATE');
      else requireThat(timebase && BigInt(duration) * BigInt(timebase.num) * BigInt(e.sample_rate) * BigInt(e.channels) * 4n === BigInt(timebase.den) * BigInt(size), 'AUDIO_SAMPLE_SIZE');
    });
    requireThat(timebase && count > 0, 'EMPTY_DECODE');
    if (kind === 'video') { requireThat(count === e.frames, 'VIDEO_FRAME_COUNT'); result.video = { ...e, decoded_frame_sha256: h.digest('hex') }; }
    else { requireThat(BigInt(units) * BigInt(timebase.num) * BigInt(e.sample_rate) === BigInt(e.samples) * BigInt(timebase.den), 'AUDIO_SAMPLE_COUNT'); result.audio = { ...e, decoded_frame_sha256: h.digest('hex') }; }
  }
  return result;
}
export function manifestDescriptors(manifest) {
  return [...OBJECTS.map(role => manifest.objects[role]), ...manifest.assets.map(asset => asset.file), ...manifest.approvals.map(approval => approval.file)];
}
export async function validatePackage(packageRoot, policyPath) {
  const root = noSymlinks(packageRoot), manifestPath = contained(root, 'manifest.json');
  const manifestHash = fileHash(manifestPath, MAX_JSON), manifestBytes = fs.readFileSync(manifestPath);
  requireThat(sha256(manifestBytes) === manifestHash.sha256, 'MANIFEST_CHANGED');
  const manifest = parseCanonical(manifestBytes, 'manifest');
  exactKeys(manifest, ['schema', 'case_id', 'release_id', 'test_fixture', 'objects', 'assets', 'delivery_media_id', 'approvals'], 'manifest');
  requireThat(manifest.schema === SCHEMA && typeof manifest.test_fixture === 'boolean', 'MANIFEST_SCHEMA'); identifier(manifest.case_id, 'case'); identifier(manifest.release_id, 'release');
  requireThat(manifest.test_fixture === manifest.case_id.startsWith('ENGINE_TEST_'), 'TEST_SCOPE');
  const policy = loadPolicy(policyPath, root);
  requireThat(policy.case_id === manifest.case_id && policy.test_fixture === manifest.test_fixture, 'POLICY_CASE');
  exactKeys(manifest.objects, OBJECTS, 'objects'); requireThat(OBJECTS.every(role => manifest.objects[role]), 'MISSING_OBJECT');
  requireThat(Array.isArray(manifest.assets) && manifest.assets.length >= 4 && manifest.assets.length <= 256 && Array.isArray(manifest.approvals) && manifest.approvals.length === ROLES.length, 'MANIFEST_COUNTS');
  const all = manifestDescriptors(manifest); all.forEach((ref, index) => descriptor(ref, String(index)));
  unique(all.map(ref => ref.path), 'paths'); unique(all.map(ref => ref.public_name), 'public names');
  requireThat(!all.some(ref => ref.path === 'manifest.json' || ref.path === 'PREPARATION.json'), 'RESERVED_PATH');
  const inventory = [], objects = Object.fromEntries(OBJECTS.map(role => [role, record(root, manifest.objects[role], role, inventory)]));
  for (const role of OBJECTS) context(objects[role], manifest, role, role === 'authority' ? 'FINAL' : 'LOCKED');
  const assets = new Map();
  for (const asset of manifest.assets) {
    exactKeys(asset, ['id', 'kind', 'file', 'expected'], 'asset'); identifier(asset.id, 'asset'); requireThat(!assets.has(asset.id) && ['document', 'media'].includes(asset.kind), 'ASSET_ID');
    requireThat(asset.kind !== 'document' || asset.file.size_bytes <= MAX_JSON, 'DOCUMENT_TOO_LARGE');
    const absolute = boundFile(root, asset.file, asset.id, inventory);
    requireThat(asset.kind === 'media' ? !!asset.expected : asset.expected === undefined, 'ASSET_EXPECTATION'); assets.set(asset.id, { ...asset, absolute });
  }
  function asset(id, kind) { const a = assets.get(id); requireThat(a && a.kind === kind, 'ASSET_REFERENCE', id); return a; }
  const scriptAsset = asset(objects.script.script_asset_id, 'document'); requireThat(scriptAsset.file.size_bytes <= MAX_JSON, 'SCRIPT_TOO_LARGE');
  requireThat(objects.shots.script_sha256 === manifest.objects.script.sha256 && objects.selection.shots_sha256 === manifest.objects.shots.sha256 && objects.timeline.selection_sha256 === manifest.objects.selection.sha256, 'LOCK_CHAIN');
  const shots = objects.shots.shots; requireThat(Array.isArray(shots) && shots.length > 0 && shots.length <= 1000, 'SHOT_COUNT');
  shots.forEach(shot => { identifier(shot.id, 'shot'); requireThat(typeof shot.function === 'string' && shot.function.trim().length > 0, 'SHOT_FUNCTION'); }); unique(shots.map(s => s.id), 'shots');
  const takes = objects.selection.takes; requireThat(Array.isArray(takes) && takes.length > 0 && takes.length <= 1000, 'NO_SELECTED_TAKES');
  unique(takes.map(t => t.id), 'takes'); const shotIDs = new Set(shots.map(s => s.id)), used = new Set([scriptAsset.id]);
  for (const take of takes) {
    identifier(take.id, 'take'); requireThat(shotIDs.has(take.shot_id), 'TAKE_SHOT'); const media = asset(take.media_id, 'media'), provenance = asset(take.provenance_asset_id, 'document');
    const provenanceBytes = fs.readFileSync(provenance.absolute); requireThat(sha256(provenanceBytes) === provenance.file.sha256, 'PROVENANCE_CHANGED');
    const p = parseCanonical(provenanceBytes, 'provenance');
    requireThat(p.case_id === manifest.case_id && p.take_id === take.id && p.media_sha256 === media.file.sha256 && p.source_type === 'LOCAL_PRODUCTION' && p.paid_api_used === false && p.cloud_render_used === false && p.placeholder === false, 'TAKE_PROVENANCE');
    requireThat(typeof p.method === 'string' && p.method.trim() && typeof p.source_record === 'string' && p.source_record.trim(), 'PROVENANCE_DETAIL');
    used.add(media.id); used.add(provenance.id);
  }
  requireThat(shots.every(s => takes.some(t => t.shot_id === s.id)), 'UNCOVERED_SHOT');
  const timeline = objects.timeline; fraction(timeline.fps, 'timeline fps'); integer(timeline.frame_count, 1, 500000, 'timeline frames');
  requireThat(Array.isArray(timeline.segments) && timeline.segments.length > 0 && timeline.segments.length <= 2000, 'TIMELINE_EMPTY');
  let cursor = 0; const referencedTakes = new Set();
  for (const segment of timeline.segments) {
    const take = takes.find(t => t.id === segment.take_id); requireThat(take, 'TIMELINE_TAKE'); const media = asset(take.media_id, 'media');
    integer(segment.source_in_frame, 0, 500000, 'source in'); integer(segment.duration_frames, 1, 500000, 'duration');
    requireThat(segment.timeline_in_frame === cursor && media.expected.video && sameRate(media.expected.video.fps, timeline.fps) && segment.source_in_frame + segment.duration_frames <= media.expected.video.frames, 'TIMELINE_RANGE');
    cursor += segment.duration_frames; referencedTakes.add(take.id);
  }
  requireThat(cursor === timeline.frame_count && takes.every(t => referencedTakes.has(t.id)), 'TIMELINE_COVERAGE');
  const delivery = asset(manifest.delivery_media_id, 'media'), picture = asset(timeline.picture_media_id, 'media'), sound = asset(objects.sound.media_id, 'media');
  requireThat(delivery.expected.video && delivery.expected.audio && picture.expected.video && sound.expected.audio && !sound.expected.video, 'MASTER_LAYOUT');
  for (const movie of [delivery, picture]) requireThat(movie.expected.video.frames === timeline.frame_count && sameRate(movie.expected.video.fps, timeline.fps), 'MASTER_TIMING');
  requireThat(objects.sound.timeline_sha256 === manifest.objects.timeline.sha256 && objects.grade.timeline_sha256 === manifest.objects.timeline.sha256 && objects.grade.picture_sha256 === picture.file.sha256, 'MASTER_LOCK_CHAIN');
  for (const audio of [delivery.expected.audio, sound.expected.audio]) {
    requireThat(BigInt(audio.samples) * BigInt(timeline.fps.num) === BigInt(timeline.frame_count) * BigInt(timeline.fps.den) * BigInt(audio.sample_rate), 'MASTER_AUDIO_DURATION');
  }
  used.add(delivery.id); used.add(picture.id); used.add(sound.id); requireThat([...assets.keys()].every(id => used.has(id)), 'UNBOUND_ASSET');
  const subject = contentIdentity(manifest), authorizations = [];
  unique(manifest.approvals.map(x => x.role), 'approval roles');
  for (const role of ROLES) {
    const ref = manifest.approvals.find(x => x.role === role); requireThat(ref, 'MISSING_APPROVAL', role);
    exactKeys(ref, ['role', 'file'], 'approval reference'); const envelope = record(root, ref.file, role, inventory);
    const accepted = verifyEnvelope(envelope, policy, manifest, role, subject, 'PRODUCTION_APPROVAL');
    requireThat(Array.isArray(objects.authority.authorized_keys) && objects.authority.authorized_keys.some(k => k.key_id === accepted.key_id && k.role === role), 'AUTHORITY_KEY');
    if (role === 'director') requireThat(envelope.payload.audience_review && AUDIENCE.every(k => envelope.payload.audience_review[k] === 'ACCEPTED'), 'AUDIENCE_REVIEW');
    authorizations.push(accepted);
  }
  const measurements = {};
  for (const [id, a] of assets) if (a.kind === 'media') measurements[id] = await inspectMedia(a.absolute, a.expected);
  requireThat(canonical(measurements[delivery.id].video) === canonical(measurements[picture.id].video), 'DELIVERY_PICTURE_MISMATCH');
  requireThat(canonical(measurements[delivery.id].audio) === canonical(measurements[sound.id].audio), 'DELIVERY_MIX_MISMATCH');
  for (const ref of inventory) { const after = fileHash(contained(root, ref.path)); requireThat(after.sha256 === ref.sha256 && after.size_bytes === ref.size_bytes, 'SOURCE_CHANGED_DURING_ACCEPTANCE', ref.path); }
  requireThat(fileHash(manifestPath).sha256 === manifestHash.sha256 && fileHash(policy.path).sha256 === policy.sha256, 'INPUT_CHANGED_DURING_ACCEPTANCE');
  return { manifest, policy, report: { schema: SCHEMA, kind: 'PREPARATION', case_id: manifest.case_id, release_id: manifest.release_id, test_fixture: manifest.test_fixture, status: 'READY_FOR_PUBLIC_REPLAY', validator_sha256: fileHash(fileURLToPath(import.meta.url), MAX_JSON).sha256, driver_sha256: fileHash(fileURLToPath(new URL('../final-release.mjs', import.meta.url)), MAX_JSON).sha256, content_sha256: subject, manifest_sha256: manifestHash.sha256, trust_policy_sha256: policy.sha256, authorizations, files: inventory.sort((a, b) => a.path.localeCompare(b.path)), measurements, claims: { proves_truth: false, proves_external_reality: false, proves_film_issued: false, proves_admissibility: false } } };
}
export function exclusiveJson(filename, value) {
  noSymlinks(path.dirname(filename)); const bytes = jsonBytes(value);
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return { sha256: sha256(bytes), size_bytes: bytes.length };
}
export function preparationMatches(preparation, report) {
  requireThat(canonical(preparation) === canonical(report), 'PREPARATION_STALE');
}
export function verifyReplay(validation, preparationBytes, replayEnvelope) {
  const { manifest, policy, report } = validation, preparation = parseCanonical(preparationBytes, 'preparation'); preparationMatches(preparation, report);
  const preparationSHA = sha256(preparationBytes);
  const witness = verifyEnvelope(replayEnvelope, policy, manifest, 'replay', preparationSHA, 'INDEPENDENT_PUBLIC_REPLAY');
  requireThat(replayEnvelope.payload.manifest_sha256 === report.manifest_sha256 && replayEnvelope.payload.content_sha256 === report.content_sha256 && replayEnvelope.payload.all_media_decoded === true && replayEnvelope.payload.public_capture && HASH.test(replayEnvelope.payload.public_capture.sha256), 'REPLAY_BINDING');
  publicManifestURL(replayEnvelope.payload.public_manifest_url);
  requireThat(!report.authorizations.some(a => a.key_id === witness.key_id || a.principal_id === witness.principal_id), 'REPLAY_NOT_INDEPENDENT');
  return { preparationSHA, witness, decisionSubject: digest({ preparation_sha256: preparationSHA, replay_sha256: digest(replayEnvelope) }) };
}
export function finalizeReceipt(validation, preparationBytes, replayEnvelope, issuanceEnvelope) {
  const { manifest, policy, report } = validation;
  const { preparationSHA, witness, decisionSubject } = verifyReplay(validation, preparationBytes, replayEnvelope);
  const issuer = verifyEnvelope(issuanceEnvelope, policy, manifest, 'issuer', decisionSubject, 'ISSUANCE_AUTHORIZATION');
  requireThat(issuer.key_id !== witness.key_id && issuer.principal_id !== witness.principal_id, 'ISSUER_IS_REPLAY');
  return { schema: SCHEMA, kind: 'FINAL_ISSUANCE', case_id: manifest.case_id, release_id: manifest.release_id, test_fixture: manifest.test_fixture, status: manifest.test_fixture ? 'TEST_FIXTURE_ACCEPTED_NOT_ISSUED' : 'ISSUED_ADMISSIBLE_MOTION_PICTURE', content_sha256: report.content_sha256, preparation_sha256: preparationSHA, replay_sha256: digest(replayEnvelope), authorization_sha256: digest(issuanceEnvelope), delivery: manifest.assets.find(a => a.id === manifest.delivery_media_id).file, public_manifest_url: replayEnvelope.payload.public_manifest_url, witness, issuer, claims: { proves_truth: false, proves_external_reality: false, proves_film_issued: !manifest.test_fixture, proves_admissibility: !manifest.test_fixture, basis: 'Explicit authorized artistic and issuance decisions, verified media/provenance bindings and an independently signed public replay; signatures authenticate configured keys, not artistic judgment by software.' } };
}

export function terminalClosure(receipt) {
  return { schema: SCHEMA, kind: 'TERMINAL_CLOSURE', case_id: receipt.case_id,
    release_id: receipt.release_id, test_fixture: receipt.test_fixture,
    status: receipt.test_fixture ? 'TEST_FIXTURE_NOT_CLOSED' : 'CLOSED_BY_AUTHORIZED_ISSUANCE',
    receipt_sha256: digest(receipt), claims: receipt.claims };
}

export function verifyFinalized(validation, directory) {
  const names = ['FINAL_ISSUANCE_RECEIPT.json','INDEPENDENT_REPLAY.json','ISSUANCE_AUTHORIZATION.json',
    'PREPARATION.json','RELEASE_MANIFEST.json','TERMINAL_CLOSURE.json'].sort();
  const commitPath = contained(directory, 'COMMITTED.json'); fileHash(commitPath, MAX_JSON);
  const commit = parseCanonical(fs.readFileSync(commitPath), 'commit marker');
  requireThat(commit.schema === SCHEMA && commit.kind === 'FINAL_RELEASE_COMMIT' &&
    commit.case_id === validation.manifest.case_id && commit.release_id === validation.manifest.release_id &&
    commit.test_fixture === validation.manifest.test_fixture && Array.isArray(commit.files), 'COMMIT_BINDING');
  requireThat(canonical(commit.files.map(f => f.name).sort()) === canonical(names), 'COMMIT_FILES');
  const records = {};
  for (const item of commit.files) {
    requireThat(PUBLIC_NAME.test(item.name), 'COMMIT_PATH'); const filename = contained(directory, item.name), identity = fileHash(filename, MAX_JSON);
    requireThat(identity.sha256 === item.sha256 && identity.size_bytes === item.size_bytes, 'COMMIT_CONTENT', item.name);
    records[item.name] = parseCanonical(fs.readFileSync(filename), item.name);
    requireThat(sha256(jsonBytes(records[item.name])) === item.sha256, 'COMMIT_CHANGED');
  }
  requireThat(canonical(records['RELEASE_MANIFEST.json']) === canonical(validation.manifest), 'FINAL_MANIFEST_CHANGED');
  const receipt = finalizeReceipt(validation, jsonBytes(records['PREPARATION.json']), records['INDEPENDENT_REPLAY.json'], records['ISSUANCE_AUTHORIZATION.json']);
  requireThat(canonical(receipt) === canonical(records['FINAL_ISSUANCE_RECEIPT.json']), 'FINAL_RECEIPT_CHANGED');
  requireThat(canonical(terminalClosure(receipt)) === canonical(records['TERMINAL_CLOSURE.json']), 'CLOSURE_CHANGED');
  return receipt;
}

export function publicManifestURL(value) {
  const u = new URL(value);
  requireThat(u.protocol === 'https:' && u.hostname === 'github.com' && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/(CINEMATICUM|kaaffilm)\/CINEMATICUM\/releases\/download\/[A-Za-z0-9_.-]+\/manifest\.json$/.test(u.pathname), 'PUBLIC_RELEASE_URL');
  return u;
}
export async function capturePublicRelease(url, destination, fetchImpl = fetch) {
  const manifestURL = publicManifestURL(url); requireThat(!fs.existsSync(destination), 'OUTPUT_EXISTS'); noSymlinks(path.dirname(path.resolve(destination)));
  fs.mkdirSync(destination, { mode: 0o700 }); const capture = [], fetchedNames = new Set(); let totalBytes = 0;
  async function download(publicName, localName, expected, maximum) {
    requireThat(!fetchedNames.has(publicName), 'DUPLICATE_PUBLIC_ASSET'); fetchedNames.add(publicName);
    let current = new URL(publicName, manifestURL), response;
    for (let redirect = 0; redirect < 6; redirect++) {
      response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(120000), credentials: 'omit', headers: { Accept: 'application/octet-stream' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      requireThat(redirect < 5 && response.headers.get('location'), 'REDIRECT_LIMIT');
      current = new URL(response.headers.get('location'), current);
      requireThat(current.protocol === 'https:' && ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(current.hostname) && !current.port && !current.username && !current.password, 'REDIRECT_HOST');
      await response.body?.cancel();
    }
    requireThat(response.status === 200 && response.body, 'PUBLIC_DOWNLOAD_FAILED', publicName);
    requireThat(typeof localName === 'string' && localName.length < 512 && !localName.includes('\0') && localName.split('/').every(p => p && p !== '.' && p !== '..') && !path.isAbsolute(localName) && !localName.includes('\\'), 'UNSAFE_PATH');
    const target = path.resolve(destination, localName); requireThat(target.startsWith(path.resolve(destination) + path.sep), 'PATH_ESCAPE'); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); noSymlinks(path.dirname(target));
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600), h = createHash('sha256'); let size = 0;
    try { for await (const data of response.body) { size += data.length; totalBytes += data.length; requireThat(size <= maximum && totalBytes <= MAX_MEDIA * 2, 'DOWNLOAD_LIMIT'); fs.writeFileSync(fd, data); h.update(data); } fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const identity = { sha256: h.digest('hex'), size_bytes: size }; requireThat(size > 0 && (!expected || (identity.sha256 === expected.sha256 && size === expected.size_bytes)), 'PUBLIC_HASH_MISMATCH', publicName);
    capture.push({ public_name: publicName, path: localName, ...identity }); return target;
  }
  try {
    const manifestPath = await download('manifest.json', 'manifest.json', null, MAX_JSON), manifest = parseCanonical(fs.readFileSync(manifestPath), 'public manifest');
    requireThat(manifest.schema === SCHEMA && Array.isArray(manifest.assets) && manifest.assets.length <= 256 && Array.isArray(manifest.approvals) && manifest.approvals.length === 5 && manifest.objects, 'PUBLIC_MANIFEST');
    const refs = manifestDescriptors(manifest); refs.forEach((ref, i) => descriptor(ref, String(i))); unique(refs.map(ref => ref.path), 'public paths'); unique(refs.map(ref => ref.public_name), 'public names');
    for (const ref of refs) await download(ref.public_name, ref.path, ref, ref.size_bytes);
    await download('PREPARATION.json', 'PREPARATION.json', null, MAX_JSON);
    const result = { schema: SCHEMA, kind: 'PUBLIC_CAPTURE', manifest_url: manifestURL.href, captured_at: new Date().toISOString(), files: capture, authentication_used: false };
    exclusiveJson(path.join(destination, 'PUBLIC_CAPTURE.json'), result); return result;
  } catch (error) {
    // Preserve partial bytes and the exact failure for inspection; never turn them into a replay pass.
    try { exclusiveJson(path.join(destination, 'CAPTURE_FAILURE.json'), { schema: SCHEMA, failed: true, message: String(error.message).slice(0,2048) }); } catch {}
    throw error;
  }
}
