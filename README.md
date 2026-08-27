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

A reciprocal acknowledgement in the production/replay repository is still required before the cross-repository canonicality relation is considered fully resolved.

Canonical machine-readable authority object:

```text
AUTHORITY/CINEMATICUM_REPOSITORY_AUTHORITY_BINDING.json
```

Verification:

```bash
node scripts/verify-cross-repository-authority-binding.mjs
```

<!-- CINEMATICUM_CROSS_REPOSITORY_AUTHORITY_BINDING_V1_END -->

