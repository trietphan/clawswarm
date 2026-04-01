# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | ✅ Current release |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report vulnerabilities responsibly via one of these channels:

1. **GitHub Security Advisories** (preferred):  
   Go to [Security → Advisories → New draft advisory](https://github.com/trietphan/clawswarm/security/advisories/new) to privately report the issue.

2. **Email**:  
   Send details to the maintainers at the email address listed in the repository's profile.

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- The affected package(s) and version(s)
- Any suggested fix (optional but appreciated)

### What to expect

- **Acknowledgment** within 48 hours of your report
- **Status update** within 7 days with an assessment and timeline
- **Fix or mitigation** as soon as practical, typically within 30 days for confirmed issues
- **Credit** in the release notes (unless you prefer to remain anonymous)

We appreciate responsible disclosure and will work with you to understand and address the issue before any public disclosure.

## Security Best Practices for Users

- Keep ClawSwarm and its dependencies up to date
- Never commit API keys, tokens, or secrets to your repository
- Use environment variables or secret managers for sensitive configuration
- Review agent task definitions for unintended permission escalation
- Run untrusted agent workloads in sandboxed environments
