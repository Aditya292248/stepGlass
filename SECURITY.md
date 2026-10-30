# Security Policy

## Supported versions

Stepglass is pre-alpha. Security fixes are made on `main` only until the first release.

## Reporting a vulnerability

**Please don't report vulnerabilities in public issues.**

Report them privately through GitHub's
[private vulnerability reporting](https://github.com/Aditya292248/stepGlass/security/advisories/new).
Include the affected component, steps to reproduce, and the impact you expect.

You can expect an acknowledgement within 3 business days and a status update within 10 business
days. Once a fix is available we'll publish an advisory and credit you, unless you'd rather stay
anonymous.

## Scope

Stepglass records agent activity, which may include sensitive business data. We especially want to
hear about:

- reading, streaming, exporting or deleting another user's sessions;
- secrets or configured sensitive fields reaching stored traces or exports;
- recorded trace text that changes check results or triggers tool calls;
- connector credentials leaking, or live connectors acting outside their allowlists.
