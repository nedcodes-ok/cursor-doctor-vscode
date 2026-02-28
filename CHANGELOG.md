# Changelog

## 0.7.7 (2026-02-28)

- **Lint accuracy improvements** — context-aware vague rule detection skips qualified phrases like "be consistent with X"
- **Empty frontmatter detection** — catches empty description values (empty strings and YAML empty arrays)
- **Dead rule detection** — ERROR-level "Rule will never load" for alwaysApply: false with no globs
- **False positive fix** — description check no longer flags empty descriptions twice

## 0.7.6 (2026-02-28)

- **Windows CRLF support** — normalize line endings in all file reads
- **Binary file detection** — skip non-text files with clear warning
- **Exit code 2** for system/internal errors (distinct from lint issues)

## 0.7.5 (2026-02-28)

- **Security hardening** — command injection sanitization, SSRF URL validation, path traversal guards
- **Plugin walkFiles fix** — exclude node_modules, depth limit 5
- **LSP rewrite** — Content-Length byte reading for reliable IDE communication
- **Prototype pollution prevention** — Object.create(null) for parsed data
- **Performance** — 10KB body guard on file path regex, fetch timeouts

## 0.7.0 — 0.7.4 (2026-02-28)

- **YAML array support** — parseFrontmatter handles multi-line glob arrays
- **alwaysApply logic fix** — warn only when both alwaysApply AND globs are missing
- **TTY-aware colors** — respects NO_COLOR env var and pipe detection
- **Token estimation** — 10% overhead factor for accuracy
- **60+ lint rules** covering frontmatter, globs, prompt engineering, project structure

## 0.2.0 (2026-02-27)

- **Quick Fix actions** — click the 💡 lightbulb to fix issues inline (add frontmatter, convert globs to YAML array, add alwaysApply, migrate .cursorrules, and more)
- **Welcome panel** — first-run onboarding shows how to use Cursor Doctor
- **Screenshots** — README now includes screenshots of status bar, scan report, and quick fixes
- Code action provider for .mdc and .cursorrules files
- Diagnostic codes for all lint issues

## 0.1.0 (2026-02-27)

- Initial release
- Health grade in status bar (A-F)
- 9 health checks with full scan report
- Inline diagnostics for .mdc and .cursorrules files
- Auto-fix (Pro): repair frontmatter, merge rules, generate templates
- Migrate .cursorrules to .mdc
- Pro license activation
