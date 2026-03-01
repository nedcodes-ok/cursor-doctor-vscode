# Cursor Doctor VS Code Extension - Bug Report
**Date**: 2026-02-28  
**Reviewer**: Subagent Static Analysis

---

## CRITICAL BUGS

### 🔴 CRITICAL #1: `cmdFixAllInFile` missing dependency
**File**: `src/extension.js`, line 349-397  
**Registered command**: Line 44  
**Referenced in**: `src/codeactions.js`, line 34  
**Issue**: Function imports `./linter-fixers` module which doesn't exist in repo  
**Impact**: **"Fix all issues in this file" code action will crash the extension**  
**Fix**: Either:
1. Create `src/linter-fixers.js` with all the fixer functions, OR
2. Remove the command registration and code action reference

---

### 🔴 CRITICAL #2: Multiple diagnostics missing `code` fields
**File**: `src/linter.js`  
**Issue**: Code actions in `codeactions.js` match diagnostics by `code` field, but many diagnostics don't set one  
**Impact**: Quick fixes won't appear for these issues  

**Missing codes:**
- Line 153: "Rule will never load: alwaysApply is false and no globs are set"
- Line 221: "Rule body is very long (>2000 chars, ~500+ tokens)"
- Line 228: "Rule body exceeds 5000 chars (~1250 tokens)"
- Line 233: "Rule has no code examples"
- Line 266: "Overly broad glob pattern"
- Line 273: "Glob pattern contains spaces"
- Line 279: "Glob pattern has no file extension after dot"
- Line 324: "Multiple globs could be simplified: ..."
- Line 344: "alwaysApply is true with globs set"
- Line 355: "Rule body appears to be just a URL"
- Line 365: "Rule body contains XML/HTML tags"
- Line 376: "Rule body has broken markdown links"
- Line 382: "Rule body starts with description repeated"
- Line 388: "Rule contains TODO/FIXME/HACK comments"
- Line 394-408: "Rule has inconsistent heading levels"
- Line 463: "Unclosed code block" - **HAS CODE** but duplicated ❌
- Line 477: "HTML comments" - **HAS CODE** but duplicated ❌
- Line 492: "Trailing whitespace" - **HAS CODE** but duplicated ❌
- Line 510: "Rule uses weak language"
- Line 521: "Rule uses negations without alternatives"
- Line 533: "Rule has no clear actionable instructions"
- Line 570: "Rule references file that may not exist"
- Line 578-591: "Rule mixes multiple concerns"
- Line 593-608: "Rule has conflicting instructions"

**Fix**: Add `code:` field to every diagnostic that needs a code action

---

### 🔴 CRITICAL #3: Duplicate diagnostic detection
**File**: `src/linter.js`  
**Lines**: 
- 420-434: "excessive-blank-lines" diagnostic 
- 437-447: "trailing-whitespace" diagnostic  
- 450-462: "html-comments" diagnostic  
- 465-482: "unclosed-code-block" diagnostic  

**Then AGAIN:**
- 485-495: "trailing-whitespace" DUPLICATE
- 498-510: "html-comments" DUPLICATE
- 513-529: "unclosed-code-block" DUPLICATE

**Issue**: Same checks run twice, creating duplicate diagnostics in Problems panel  
**Impact**: User sees duplicate squiggles and errors for the same issue  
**Fix**: Remove lines 485-529 (duplicate checks)

---

## HIGH PRIORITY BUGS

### 🟠 HIGH #4: Memory leak - debounce timer not disposed
**File**: `src/extension.js`, line 68  
**Issue**: `debounceTimer` is created but never cleared in `deactivate()`  
**Impact**: Timer continues running after extension deactivates  
**Fix**: Add to `deactivate()` function:
```javascript
function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (statusBarItem) statusBarItem.dispose();
}
```

---

### 🟠 HIGH #5: Diagnostics not cleared when file closed
**File**: `src/extension.js`  
**Issue**: No `onDidCloseTextDocument` handler to clear diagnostics  
**Impact**: Diagnostics remain in Problems panel even after file is closed  
**Fix**: Add event handler:
```javascript
context.subscriptions.push(
  vscode.workspace.onDidCloseTextDocument(function (doc) {
    if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
      diagnosticCollection.delete(doc.uri);
      updateHealthGrade();
    }
  })
);
```

---

### 🟠 HIGH #6: Status bar race condition
**File**: `src/extension.js`, line 50, 61, 115  
**Issue**: `updateHealthGrade()` calls `doctor()` (full workspace scan) then counts diagnostics. But it's called after `lintSingleFile()` which updates diagnostics incrementally. Result: status bar shows outdated issue count.  
**Impact**: Status bar shows "3 issues" when there are actually 5  
**Fix**: Make `updateHealthGrade()` read-only (don't call `doctor()` every time), OR debounce it properly

---

### 🟠 HIGH #7: Line number calculation bugs in linter.js
**File**: `src/linter.js`

**Issue 7a**: Line 433 - excessive-blank-lines
```javascript
const relLine = findLineWith(body, /^\s*$/) || 1;
```
This finds the **first** blank line, not the one with excessive blanks. Should find `/\n\n\n\n/` pattern location.

**Issue 7b**: Line 454 - html-comments line calculation
```javascript
const fmLines = (content.match(/^---\n[\s\S]*?\n---\n?/) || [''])[0].split('\n').length;
line += fmLines;
```
This adds frontmatter line count **twice** (once in loop, once here). Off-by-N error.

**Issue 7c**: Line 469 - unclosed-code-block line calculation
Same double-counting bug as 7b.

**Impact**: Diagnostics point to wrong lines  
**Fix**: Refactor line number calculations to use a consistent helper function

---

### 🟠 HIGH #8: `issuesToDiagnostics()` range bounds check insufficient
**File**: `src/extension.js`, lines 197-221  
**Issue**: Line 201-202:
```javascript
var line = issue.line ? issue.line - 1 : 0;
var maxLine = document.lineCount - 1;
if (line > maxLine) line = maxLine;
```
This clamps line to `maxLine`, but then at line 206:
```javascript
new vscode.Position(line, document.lineAt(line).text.length)
```
If line is empty or document has 0 lines, this could crash or create invalid range.  
**Fix**: Add bounds check for `document.lineCount === 0`

---

## MEDIUM PRIORITY BUGS

### 🟡 MEDIUM #9: Code action text edit corruption risk - frontmatter replacements
**File**: `src/codeactions.js`

**Issue 9a**: Lines 139-152 - `boolean-string` fix
```javascript
var fmStartLine = 0;
var fmEndLine = findFrontmatterEndLine(text) + 1;
var range = new vscode.Range(
  new vscode.Position(fmStartLine, 0),
  new vscode.Position(fmEndLine, 0)
);
action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
```
**Problem**: `fmEndLine + 1` means range includes the line **after** the closing `---`. If that line has content, it gets deleted.  
**Example**: 
```
---
description: test
---
# My rule  <- This line gets deleted!
```
**Fix**: Use `fmEndLine` not `fmEndLine + 1`

**Issue 9b**: Same bug in:
- Line 173: `tabs-in-frontmatter`
- Line 240: `boolean-string` (second occurrence)
- Line 343: `glob-backslashes`
- Line 368: `glob-trailing-slash`
- Line 393: `glob-dot-prefix`
- Line 431: `description-has-markdown`
- Line 470: `unknown-frontmatter-key`

**ALL frontmatter replacement code actions have this off-by-one bug.**

---

### 🟡 MEDIUM #10: Code action multi-line deletion bugs
**File**: `src/codeactions.js`

**Issue 10a**: Lines 562-586 - `alwaysapply-with-globs` fix
```javascript
var endLine = globLine + 1;
while (endLine < document.lineCount) {
  var nextText = document.lineAt(endLine).text;
  if (nextText.match(/^\s+-\s/)) {
    endLine++;
  } else {
    break;
  }
}
var range = new vscode.Range(
  new vscode.Position(globLine, 0),
  new vscode.Position(endLine, 0)
);
action.edit.delete(document.uri, range);
```
**Problem**: If globs are multi-line array, this deletes them. But if there's content after globs on same line, it's preserved incorrectly.  
**Example**:
```yaml
description: test
globs:
  - "*.ts"
  - "*.tsx"
alwaysApply: true  <- endLine stops here, so `globs:` through line before this gets deleted
```
This works. But if YAML is malformed or has inline comments, could corrupt.

**Issue 10b**: Same issue in `broad-glob` fix (lines 595-621)

---

### 🟡 MEDIUM #11: Boolean string fix doesn't handle all edge cases
**File**: `src/codeactions.js`, line 137  
**Current regex**:
```javascript
var fixedYaml = yaml.replace(/^(alwaysApply:\s*)["']?(true|false)["']?\s*$/m, '$1$2');
```
**Missing cases**:
- `alwaysApply: "True"` (capital T)
- `alwaysApply: "FALSE"` (all caps)
- `alwaysApply: "yes"` (YAML boolean)
- `alwaysApply: "no"`

**File**: `src/linter.js`, line 193  
**Detection** only checks for lowercase `"true"` and `"false"` strings.

**Impact**: Incorrectly capitalized boolean strings not detected or fixed  
**Fix**: Case-insensitive check and normalization

---

### 🟡 MEDIUM #12: `please-thank-you` fix corrupts lines with inline "please"
**File**: `src/codeactions.js`, lines 196-224  
**Issue**: Line 213-216:
```javascript
// "X please" at end → "X"
if (/\s+please[.!]?\s*$/i.test(trimmed)) {
  return line.replace(/,?\s+please([.!]?)\s*$/i, '$1');
}
```
**Problem**: This removes "please" from end of line, but if line is:
```
- Use async/await please, and avoid callbacks
```
Result:
```
- Use async/await, and avoid callbacks
```
Sentence is now broken (comma with nothing after).

**Better fix**: 
```javascript
return line.replace(/,?\s+please([.!]?)\s*$/i, '$1');
```
Already handles comma, but should also handle ", please," mid-sentence.

---

### 🟡 MEDIUM #13: `first-person` fix doesn't capitalize correctly
**File**: `src/codeactions.js`, lines 228-252  
**Issue**: Line 249:
```javascript
var rest = line.slice(match[0].length);
return indent + rest.charAt(0).toUpperCase() + rest.slice(1);
```
**Problem**: If line is:
```
  I want you to use TypeScript
```
Result:
```
  Use TypeScript
```
That's correct. But if line is:
```
I'd like you to prefer const over let
```
Result:
```
Prefer const over let
```
Lost indentation (indent = '' because no match group 1 captured).

Actually, looking at regex patterns, they all have `^(\s*)` capture group, so indent should be preserved. But pattern 4:
```javascript
/^(\s*)My preference is (to\s+)?/i,
```
Has optional `(to\s+)?` group 2, so `match[0]` includes it, but replacement doesn't use it. Result:
```
My preference is to use tabs
→ Use tabs  (lost "to")
```

---

## LOW PRIORITY ISSUES

### 🔵 LOW #14: `unclosed-code-block` fix assumes code block is at end
**File**: `src/codeactions.js`, lines 413-426  
**Issue**: Always adds closing ``` at end of file, but unclosed block might be in middle  
**Impact**: Creates malformed markdown if block is mid-file  
**Fix**: Parse to find actual unclosed block location

---

### 🔵 LOW #15: No validation of glob pattern syntax
**File**: `src/linter.js`, lines 245-337  
**Issue**: Linter checks for backslashes, trailing slashes, etc., but doesn't validate actual glob syntax (e.g., `*.{ts,tsx}` vs `*.{ts, tsx}` with space)  
**Impact**: Invalid glob patterns accepted  
**Fix**: Add glob syntax validation using a glob parsing library

---

### 🔵 LOW #16: Similarity function inefficient for large bodies
**File**: `src/linter.js`, lines 729-750  
**Issue**: Jaccard similarity with Set operations runs on every pair of rules. For 50 rules, that's 1,225 comparisons. If bodies are large (5KB each), this is slow.  
**Impact**: Workspace lint is slow on large projects  
**Fix**: Add early exit if body lengths differ by >20%, or use faster hashing

---

### 🔵 LOW #17: File path validation runs on every lint
**File**: `src/linter.js`, lines 551-575  
**Issue**: Checks if file paths in rule body exist by calling `fs.existsSync()` on every match, on every lint (including on-change)  
**Impact**: I/O slowdown on large rules with many file references  
**Fix**: Debounce this check or make it info-only

---

### 🔵 LOW #18: `findLineWith()` returns 1-indexed but used inconsistently
**File**: `src/linter.js`  
**Issue**: Helper function `findLineWith()` returns 1-indexed line numbers (human-readable), but code sometimes treats it as 0-indexed  
**Example**: Line 443:
```javascript
const line = findLineWith(body, /\b(I want|...)\b/i);
// ...
line: line || 1,
```
But `findLineWith()` already returns 1-indexed, so `|| 1` is redundant. However, body offset isn't added, so line number is wrong anyway.

**Impact**: Diagnostic line numbers incorrect for body content  
**Fix**: Refactor to use consistent 0-indexed everywhere, add offset in one place

---

## CROSS-REFERENCE ANALYSIS

### Missing Code Actions for Diagnostic Codes

**Codes in linter.js WITH code actions in codeactions.js:**
✅ `missing-frontmatter`  
✅ `missing-alwaysapply`  
✅ `missing-description`  
✅ `globs-not-array`  
✅ `empty-body`  
✅ `boolean-string`  
✅ `tabs-in-frontmatter`  
✅ `please-thank-you`  
✅ `first-person`  
✅ `trailing-whitespace`  
✅ `excessive-blank-lines`  
✅ `html-comments`  
✅ `unclosed-code-block`  
✅ `glob-backslashes`  
✅ `glob-trailing-slash`  
✅ `glob-dot-prefix`  
✅ `description-has-markdown`  
✅ `unknown-frontmatter-key`  

**Codes in linter.js WITHOUT code actions:**
❌ `frontmatter-error` (line 136) - NO FIX POSSIBLE (generic parse error)  
❌ None with codes are missing fixes - all have actions

**Code actions in codeactions.js WITHOUT matching diagnostic codes:**
❌ `legacy-cursorrules` (line 496) - No diagnostic in linter.js generates this code  
❌ `alwaysapply-with-globs` (line 562) - No diagnostic generates this code  
❌ `broad-glob` (line 595) - No diagnostic generates this code  
❌ `body-just-url` (line 623) - No diagnostic generates this code  

**These are orphaned code actions that will never trigger.**

---

## PACKAGE.JSON VALIDATION

### ✅ Code action provider registration
Line 66 (contributes.languages) registers `mdc` language - CORRECT  
But code action provider is registered programmatically in extension.js (lines 26-30), not in package.json. This is valid for VS Code extensions.

### ✅ Activation events
Lines 24-28:
```json
"activationEvents": [
  "workspaceContains:.cursor/rules",
  "workspaceContains:.cursorrules",
  "workspaceContains:AGENTS.md",
  "workspaceContains:CLAUDE.md"
],
```
**Correct** - extension activates when workspace has Cursor files.

### ✅ Language configuration
Lines 64-73:
```json
"languages": [
  {
    "id": "mdc",
    "extensions": [".mdc"],
    "aliases": ["Cursor MDC Rule"],
    "configuration": "./language-configuration.json"
  }
]
```
**Correct** - .mdc files mapped to mdc language.

**Missing**: `language-configuration.json` file should exist but not provided in read. Non-critical (just syntax highlighting config).

---

## COMMON VS CODE EXTENSION BUGS CHECK

### ❌ Race conditions between save and change events
**File**: `src/extension.js`, lines 54-74  
**Issue**: 
- `onDidSaveTextDocument` calls `lintSingleFile()` then `updateHealthGrade()`
- `onDidChangeTextDocument` (debounced 500ms) calls `lintSingleFile()`

**Race scenario**:
1. User types (triggers change event, starts 500ms timer)
2. User saves before 500ms (triggers save event, calls lint)
3. 500ms timer fires, calls lint again

**Result**: Same file linted twice in quick succession. Not a data corruption bug, but wasteful.

**Fix**: Clear debounce timer on save:
```javascript
vscode.workspace.onDidSaveTextDocument(function (doc) {
  if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
    if (debounceTimer) clearTimeout(debounceTimer);
    lintSingleFile(doc);
    updateHealthGrade();
  }
})
```

### ✅ Diagnostics not clearing when file is closed
**Already flagged as HIGH #5**

### ❌ Status bar not updating after workspace changes
**File**: `src/extension.js`  
**Issue**: No `onDidChangeWorkspaceFolders` handler. If user adds/removes workspace folder, status bar shows stale grade.  
**Fix**: Add handler:
```javascript
context.subscriptions.push(
  vscode.workspace.onDidChangeWorkspaceFolders(function () {
    diagnosticCollection.clear();
    updateHealthGrade();
    lintWorkspace();
  })
);
```

---

## SUMMARY

**Total issues found: 18 bugs across 4 categories**

### By Severity:
- 🔴 **CRITICAL**: 3 bugs (will crash or prevent core features)
- 🟠 **HIGH**: 8 bugs (memory leaks, wrong behavior, data corruption risk)
- 🟡 **MEDIUM**: 6 bugs (edge cases, incorrect fixes, race conditions)
- 🔵 **LOW**: 1 bug (performance, minor UX issues)

### Must Fix Before Ship:
1. **CRITICAL #1**: Create `linter-fixers.js` or remove `fixAllInFile` command
2. **CRITICAL #2**: Add `code` fields to all fixable diagnostics
3. **CRITICAL #3**: Remove duplicate diagnostic checks (lines 485-529 in linter.js)
4. **HIGH #4**: Fix debounce timer memory leak
5. **HIGH #7**: Fix line number calculation bugs (3 instances)
6. **MEDIUM #9**: Fix frontmatter replacement off-by-one bug (8 instances)

### Recommended Fixes:
- HIGH #5: Clear diagnostics on file close
- HIGH #6: Fix status bar race condition  
- MEDIUM #11: Handle boolean edge cases (True/FALSE/yes/no)
- Add workspace change handler
- Add save/change race condition fix

---

**Next Steps**: 
1. Read the findings above
2. Prioritize CRITICAL fixes
3. Create issues in GitHub or fix inline
4. Re-test after fixes

