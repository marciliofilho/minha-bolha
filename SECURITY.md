# Security policy

## Supported versions

Only the latest release published on the [Releases page](https://github.com/marciliofilho/minha-bolha/releases) receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Use GitHub's private vulnerability reporting:

https://github.com/marciliofilho/minha-bolha/security/advisories/new

Include:

- the affected version;
- steps to reproduce;
- the impact you observed;
- any logs or screenshots that help (remove API keys, cookies and personal data first).

You can expect an initial response within a few days. Please give the maintainer reasonable time to publish a fix before disclosing the issue publicly.

## Scope

The app stores API keys, cookies and reading history locally on the user's machine. It has no server component and no telemetry. Reports about the following are especially useful:

- exposure of local secrets (API keys, session tokens, cookies);
- remote code execution or unexpected outbound requests;
- path traversal or arbitrary file write/read through the local API;
- injection in the embedded browser or in novel extraction.
