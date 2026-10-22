# CINEMATICUM

CINEMATICUM issues admissible motion pictures.

It is not an AI video generator, prompt pipeline, render farm, model wrapper, or demo clip factory.

A CINEMATICUM film is an issued motion-picture object: an audience-facing cinematic work whose authority, final cut, release artifacts, media hashes, and proof chain can survive independent replay.

## First case

`CASE_001_THE_LAST_RENDER`

Status: `CASE_OPEN_NOT_ISSUED`

## Verify

```bash
node scripts/verify-case-001.mjs
````

## Boundary

CINEMATICUM does not claim that generated media is true.

CINEMATICUM does not issue a motion picture until the audience body and evidentiary body are both complete.

<!-- CINEMATICUM_CROSS_REPOSITORY_AUTHORITY_BINDING_V1_START -->

## Repository authority topology

CINEMATICUM currently has two explicitly bounded repository roles.

`CINEMATICUM/CINEMATICUM` is the canonical cinematic jurisdiction and issuance-status authority.

`kaaffilm/CINEMATICUM` remains the independent production/replay artifact track for its pinned production and public replay objects. It is not CINEMATICUM issuance authority.

For Case 001:

```text
CASE_001_THE_LAST_RENDER
STATUS=CASE_OPEN_NOT_ISSUED
````

The existence or successful replay of a production artifact does not make that artifact an issued admissible motion picture.

The historical production repository is not deleted, archived, source-merged, or stripped of its production/replay role by this declaration.

The reciprocal acknowledgement is already merged in the production/replay repository at `e83e0074f2bbba4b7c2af9c2b81adbba1c5c28d4`. The accepted role split permits adapter implementation while preserving both repositories and keeping Case 001 open.

`AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_RESOLUTION.json` projects that existing acceptance. The original binding remains byte-identical because the production acknowledgement pins its hash. The evidence copy is the existing acknowledgement, not a new acknowledgement or a new issuance decision.

Canonical machine-readable authority object:

```text
AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_BINDING.json
```

Verification:

```bash
node scripts/verify-cross-repository-authority-binding.mjs
# Optionally recheck production main and accepted-merge ancestry through public GitHub:
node scripts/verify-cross-repository-authority-binding.mjs --online
```

<!-- CINEMATICUM_CROSS_REPOSITORY_AUTHORITY_BINDING_V1_END -->

## Final-film acceptance and issuance

The separate [final-release workflow](FINAL_RELEASE_WORKFLOW.md) verifies final authority, script and shot locks, selected-take provenance, a locked timeline, grade and sound masters, complete media hashes, signed artistic decisions, and independent public replay before producing an immutable issuance record.

```bash
node --test tests/final-release.test.mjs tests/authority-resolution.test.mjs
node scripts/final-release.mjs verify --package /path/to/release-package --trust /path/to/external-trust.json
```

This tooling does not complete or issue Case 001 by itself. Its final locks, selected takes, approved masters, authorized artistic acceptance and independent public replay still have to exist. The historical compiler-cut verifier and records remain unchanged; a compiler-cut pass does not become final-film acceptance.

