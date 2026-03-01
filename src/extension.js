const vscode = require('vscode');
const path = require('path');
const { lintProject, lintMdcFile, lintCursorrules } = require('./linter');
const { doctor } = require('./doctor');
const { autoFix } = require('./autofix');
const { migrate } = require('./migrate');
const { isLicensed, activateLicense } = require('./license');
const { CursorDoctorCodeActionProvider } = require('./codeactions');

const PURCHASE_URL_BASE = 'https://nedcodes.gumroad.com/l/cursor-doctor-pro';
const PURCHASE_URL = PURCHASE_URL_BASE + '?utm_source=vscode&utm_medium=extension&utm_campaign=scan-panel';
const FIRST_RUN_KEY = 'cursorDoctor.hasShownWelcome';

let diagnosticCollection;
let statusBarItem;
let lastReport = null;
let debounceTimer = null;
let outputChannel = null;
let gradeUpdateTimer = null;

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Cursor Doctor');
  context.subscriptions.push(outputChannel);

  diagnosticCollection = vscode.languages.createDiagnosticCollection('cursor-doctor');
  context.subscriptions.push(diagnosticCollection);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'cursorDoctor.scan';
  statusBarItem.tooltip = 'Click to run Cursor Doctor scan';
  context.subscriptions.push(statusBarItem);

  // Code action provider (quick fixes)
  var mdcSelector = { language: 'mdc', scheme: 'file' };
  var cursorruleSelector = { pattern: '**/.cursorrules' };
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(mdcSelector, new CursorDoctorCodeActionProvider(), CursorDoctorCodeActionProvider.metadata),
    vscode.languages.registerCodeActionsProvider(cursorruleSelector, new CursorDoctorCodeActionProvider(), CursorDoctorCodeActionProvider.metadata)
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorDoctor.scan', cmdScan),
    vscode.commands.registerCommand('cursorDoctor.lint', cmdLint),
    vscode.commands.registerCommand('cursorDoctor.fix', cmdFix),
    vscode.commands.registerCommand('cursorDoctor.fixAllInFile', cmdFixAllInFile),
    vscode.commands.registerCommand('cursorDoctor.migrate', cmdMigrate),
    vscode.commands.registerCommand('cursorDoctor.generate', cmdGenerate),
    vscode.commands.registerCommand('cursorDoctor.activate', cmdActivate)
  );

  // Lint on save (grade update debounced to avoid double-lint)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(function (doc) {
      if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
        lintSingleFile(doc);
        scheduleGradeUpdate();
      }
    })
  );

  // Lint on open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(function (doc) {
      if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
        lintSingleFile(doc);
      }
    })
  );

  // Lint on text change (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(function (event) {
      var doc = event.document;
      if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          lintSingleFile(doc);
          debounceTimer = null;
        }, 500);
      }
    })
  );

  // Clear diagnostics when file is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(function (doc) {
      if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
        diagnosticCollection.delete(doc.uri);
        updateHealthGrade();
      }
    })
  );

  // Run scan on activation with loading indicator
  statusBarItem.text = '$(sync~spin) Cursor Doctor';
  statusBarItem.show();
  updateHealthGrade();
  lintWorkspace();

  // First-run welcome panel
  var hasShown = context.globalState.get(FIRST_RUN_KEY, false);
  if (!hasShown) {
    context.globalState.update(FIRST_RUN_KEY, true);
    showWelcomePanel();
  }
}

function scheduleGradeUpdate() {
  if (gradeUpdateTimer) clearTimeout(gradeUpdateTimer);
  gradeUpdateTimer = setTimeout(function () {
    gradeUpdateTimer = null;
    updateHealthGrade();
  }, 1000);
}

function log(msg) {
  if (outputChannel) {
    outputChannel.appendLine('[' + new Date().toLocaleTimeString() + '] ' + msg);
  }
}

// --- Status bar health grade ---

async function updateHealthGrade() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    statusBarItem.hide();
    return;
  }

  try {
    var report = await doctor(folders[0].uri.fsPath);
    lastReport = report;

    // Count total issues from diagnostics
    var totalIssues = 0;
    diagnosticCollection.forEach(function (uri, diagnostics) {
      totalIssues += diagnostics.length;
    });

    var icons = { A: '$(pass)', B: '$(pass)', C: '$(warning)', D: '$(warning)', F: '$(error)' };
    var icon = icons[report.grade] || '$(info)';
    
    // Show grade with issue count
    var issueText = totalIssues === 0 ? '' : ' (' + totalIssues + ' issue' + (totalIssues !== 1 ? 's' : '') + ')';
    statusBarItem.text = icon + ' Cursor: ' + report.grade + issueText;

    if (report.grade === 'A' || report.grade === 'B') {
      statusBarItem.backgroundColor = undefined;
    } else if (report.grade === 'C') {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    statusBarItem.show();
  } catch (e) {
    log('Health grade update failed: ' + e.message);
    statusBarItem.text = '$(info) Cursor Doctor';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.show();
  }
}

// --- Scan command with webview ---

async function cmdScan() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) {
    vscode.window.showWarningMessage('No workspace folder open.');
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Cursor Doctor: Scanning...',
    cancellable: false
  }, async function () {
    var report = await doctor(folders[0].uri.fsPath);
    lastReport = report;
    await updateHealthGrade();
    showScanReport(report);
  });
}

function showScanReport(report) {
  var panel = vscode.window.createWebviewPanel(
    'cursorDoctorScan',
    'Cursor Doctor: Health Report',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  var gradeColors = { A: '#4ec9b0', B: '#4ec9b0', C: '#cca700', D: '#cca700', F: '#f44747' };
  var gc = gradeColors[report.grade] || '#cccccc';

  var checksHtml = '';
  for (var i = 0; i < report.checks.length; i++) {
    var check = report.checks[i];
    var icon, color;
    if (check.status === 'pass') { icon = '✓'; color = '#4ec9b0'; }
    else if (check.status === 'warn') { icon = '⚠'; color = '#cca700'; }
    else if (check.status === 'fail') { icon = '✗'; color = '#f44747'; }
    else { icon = 'ℹ'; color = '#569cd6'; }
    checksHtml += '<div style="margin: 8px 0;">';
    checksHtml += '<span style="color:' + color + '; font-size: 16px;">' + icon + '</span> ';
    checksHtml += '<strong>' + escapeHtml(check.name) + '</strong>';
    checksHtml += '<div style="margin-left: 24px; color: #999; font-size: 13px;">' + escapeHtml(check.detail) + '</div>';
    checksHtml += '</div>';
  }

  var passes = report.checks.filter(function (c) { return c.status === 'pass'; }).length;
  var fixable = report.checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; }).length;

  var barWidth = 200;
  var filled = Math.round((report.percentage / 100) * barWidth);

  panel.webview.html = '<!DOCTYPE html><html><head><style>'
    + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; color: #ccc; background: #1e1e1e; }'
    + '.grade { font-size: 48px; font-weight: bold; color: ' + gc + '; }'
    + '.pct { font-size: 24px; color: ' + gc + '; margin-left: 8px; }'
    + '.bar-bg { width: ' + barWidth + 'px; height: 8px; background: #333; border-radius: 4px; margin: 16px 0; }'
    + '.bar-fill { width: ' + filled + 'px; height: 8px; background: ' + gc + '; border-radius: 4px; }'
    + '.summary { margin: 16px 0; font-size: 14px; }'
    + '.checks { margin-top: 24px; }'
    + '.pro { margin-top: 24px; padding: 16px; background: #2d2d2d; border-radius: 8px; border-left: 3px solid #569cd6; }'
    + '</style></head><body>'
    + '<div><span class="grade">' + report.grade + '</span><span class="pct">' + report.percentage + '%</span></div>'
    + '<div class="bar-bg"><div class="bar-fill"></div></div>'
    + '<div class="summary"><span style="color:#4ec9b0">' + passes + ' passed</span>'
    + (fixable > 0 ? ' &nbsp; <span style="color:#cca700">' + fixable + ' fixable</span>' : '')
    + '</div>'
    + '<div class="checks">' + checksHtml + '</div>'
    + (fixable > 0 ? '<div class="pro">💡 <strong>Auto-fix available</strong> — Run <code>Cursor Doctor: Auto-Fix</code> from the command palette.<br><span style="color:#999; font-size:12px;">Pro license required ($9 one-time) — <a href="#" onclick="openExternal(\'' + PURCHASE_URL + '\')" style="color:#569cd6; cursor:pointer;">Get Pro</a></span></div>' : '')
    + '<script>const vscode = acquireVsCodeApi(); function openExternal(url) { vscode.postMessage({ command: "openExternal", url: url }); }</script>'
    + '</body></html>';

  panel.webview.onDidReceiveMessage(function (message) {
    if (message.command === 'openExternal' && message.url) {
      vscode.env.openExternal(vscode.Uri.parse(message.url));
    }
  }, undefined, []);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Lint command ---

async function cmdLint() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) return;
  await lintWorkspace();
  vscode.window.showInformationMessage('Cursor Doctor: Lint complete. Check Problems panel.');
}

async function lintWorkspace() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  diagnosticCollection.clear();
  var totalErrors = 0;
  var totalWarnings = 0;

  for (var fi = 0; fi < folders.length; fi++) {
    try {
      var results = await lintProject(folders[fi].uri.fsPath);
      for (var i = 0; i < results.length; i++) {
        var result = results[i];
        var uri = vscode.Uri.file(result.file);
        var doc;
        try {
          doc = await vscode.workspace.openTextDocument(uri);
        } catch (e) {
          continue;
        }

        var diagnostics = issuesToDiagnostics(result.issues, doc);
        if (diagnostics.length > 0) {
          diagnosticCollection.set(uri, diagnostics);
        }

        for (var j = 0; j < result.issues.length; j++) {
          if (result.issues[j].severity === 'error') totalErrors++;
          else totalWarnings++;
        }
      }
    } catch (e) { log('Lint workspace error: ' + e.message); }
  }

  if (totalErrors > 0 || totalWarnings > 0) {
    var parts = [];
    if (totalErrors > 0) parts.push(totalErrors + ' error' + (totalErrors !== 1 ? 's' : ''));
    if (totalWarnings > 0) parts.push(totalWarnings + ' warning' + (totalWarnings !== 1 ? 's' : ''));
    vscode.window.showWarningMessage('Cursor Doctor: ' + parts.join(', ') + ' found');
  }
}

async function lintSingleFile(document) {
  var filePath = document.uri.fsPath;
  var result;

  try {
    if (filePath.endsWith('.mdc')) {
      result = await lintMdcFile(filePath);
    } else if (filePath.endsWith('.cursorrules')) {
      result = await lintCursorrules(filePath);
    } else {
      return;
    }
  } catch (e) {
    return;
  }

  var diagnostics = issuesToDiagnostics(result.issues, document);
  diagnosticCollection.set(document.uri, diagnostics);
}

function issuesToDiagnostics(issues, document) {
  // Guard against empty documents
  if (document.lineCount === 0) {
    return [];
  }

  return issues.map(function (issue) {
    var line = issue.line ? issue.line - 1 : 0;
    var maxLine = document.lineCount - 1;
    if (line > maxLine) line = maxLine;
    if (line < 0) line = 0;
    
    var range = new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, document.lineAt(line).text.length)
    );

    var severity = issue.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;

    var diagnostic = new vscode.Diagnostic(range, issue.message, severity);
    diagnostic.source = 'cursor-doctor';
    if (issue.code) diagnostic.code = issue.code;

    if (issue.hint) {
      diagnostic.message += '\n' + issue.hint;
    }

    return diagnostic;
  });
}

// --- Fix command (Pro) ---

async function cmdFix() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  var dir = folders[0].uri.fsPath;

  if (!isLicensed(dir)) {
    var choice = await vscode.window.showWarningMessage(
      'Cursor Doctor: Auto-Fix is a Pro feature ($9 one-time).',
      'Get Pro License',
      'Activate Key'
    );
    if (choice === 'Get Pro License') {
      vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL_BASE + "?utm_source=vscode&utm_medium=extension&utm_campaign=fix-paywall"));
    } else if (choice === 'Activate Key') {
      cmdActivate();
    }
    return;
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Cursor Doctor: Fixing...',
    cancellable: false
  }, async function () {
    try {
      var results = await autoFix(dir, { dryRun: false });
      var total = results.fixed.length + results.splits.length + results.merged.length +
        results.annotated.length + results.generated.length + results.deduped.length;

      if (total === 0) {
        vscode.window.showInformationMessage('Cursor Doctor: Nothing to fix. Setup looks clean.');
      } else {
        var parts = [];
        if (results.fixed.length > 0) parts.push(results.fixed.length + ' fixed');
        if (results.merged.length > 0) parts.push(results.merged.length + ' merged');
        if (results.generated.length > 0) parts.push(results.generated.length + ' generated');
        if (results.annotated.length > 0) parts.push(results.annotated.length + ' annotated');
        vscode.window.showInformationMessage('Cursor Doctor: ' + parts.join(', ') + '.');
      }

      await updateHealthGrade();
      await lintWorkspace();
    } catch (e) {
      vscode.window.showErrorMessage('Cursor Doctor fix failed: ' + e.message);
    }
  });
}

// --- Migrate command ---

async function cmdMigrate() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  try {
    var result = migrate(folders[0].uri.fsPath);
    if (result.error) {
      vscode.window.showErrorMessage('Migration failed: ' + result.error);
      return;
    }

    var msg = 'Migrated .cursorrules: ' + result.created.length + ' file(s) created';
    if (result.skipped.length > 0) msg += ', ' + result.skipped.length + ' skipped (already exist)';
    msg += '. Verify, then delete .cursorrules manually.';
    vscode.window.showInformationMessage(msg);

    await updateHealthGrade();
    await lintWorkspace();
  } catch (e) {
    vscode.window.showErrorMessage('Migration failed: ' + e.message);
  }
}

// --- Generate command ---

async function cmdGenerate() {
  var folders = vscode.workspace.workspaceFolders;
  if (!folders) return;

  var dir = folders[0].uri.fsPath;

  if (!isLicensed(dir)) {
    var choice = await vscode.window.showWarningMessage(
      'Cursor Doctor: Generate Templates is a Pro feature ($9 one-time).',
      'Get Pro License',
      'Activate Key'
    );
    if (choice === 'Get Pro License') {
      vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL_BASE + "?utm_source=vscode&utm_medium=extension&utm_campaign=generate-paywall"));
    } else if (choice === 'Activate Key') {
      cmdActivate();
    }
    return;
  }

  try {
    var results = await autoFix(dir, { dryRun: false });
    if (results.generated.length > 0) {
      var names = results.generated.map(function (g) { return g.file; }).join(', ');
      vscode.window.showInformationMessage('Generated: ' + names);
    } else {
      vscode.window.showInformationMessage('No templates needed — your stack is covered.');
    }
    await updateHealthGrade();
  } catch (e) {
    vscode.window.showErrorMessage('Generate failed: ' + e.message);
  }
}

// --- Activate command ---

async function cmdActivate() {
  var folders = vscode.workspace.workspaceFolders;
  var dir = folders ? folders[0].uri.fsPath : process.env.HOME || '';

  var key = await vscode.window.showInputBox({
    prompt: 'Enter your Cursor Doctor Pro license key',
    placeHolder: 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
    ignoreFocusOut: true
  });

  if (!key) return;

  try {
    var result = await activateLicense(dir, key.trim());
    if (result.ok) {
      vscode.window.showInformationMessage('License activated! Pro commands unlocked.');
    } else {
      vscode.window.showErrorMessage('Activation failed: ' + result.error);
    }
  } catch (e) {
    vscode.window.showErrorMessage('Activation failed: ' + e.message);
  }
}

// --- Fix all issues in file command ---

async function cmdFixAllInFile(uri) {
  try {
    var folders = vscode.workspace.workspaceFolders;
    var dir = folders ? folders[0].uri.fsPath : '';
    if (!isLicensed(dir)) {
      var choice = await vscode.window.showWarningMessage(
        'Cursor Doctor: Fix All is a Pro feature ($9 one-time). Individual quick fixes are free.',
        'Get Pro License',
        'Activate Key'
      );
      if (choice === 'Get Pro License') {
        vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL_BASE + "?utm_source=vscode&utm_medium=extension&utm_campaign=fixall-paywall"));
      } else if (choice === 'Activate Key') {
        cmdActivate();
      }
      return;
    }

    var appliedFixes = 0;
    var provider = new CursorDoctorCodeActionProvider();
    var MAX_PASSES = 20;

    // Iterative fix: apply one fix at a time, re-lint after each to get fresh ranges
    for (var pass = 0; pass < MAX_PASSES; pass++) {
      var currentDoc = await vscode.workspace.openTextDocument(uri);
      await lintSingleFile(currentDoc);
      
      var allDiagnostics = diagnosticCollection.get(uri) || [];
      var fixableDiags = allDiagnostics.filter(function(d) { return d.code; });
      
      if (fixableDiags.length === 0) break;

      var fixed = false;
      for (var i = 0; i < fixableDiags.length; i++) {
        var diag = fixableDiags[i];
        var fakeContext = { diagnostics: [diag], only: undefined, triggerKind: 1 };
        var actions = provider.provideCodeActions(currentDoc, diag.range, fakeContext) || [];
        var fixes = actions.filter(function(a) { return a.edit; });
        
        if (fixes.length > 0) {
          await vscode.workspace.applyEdit(fixes[0].edit);
          appliedFixes++;
          fixed = true;
          break; // Re-lint before next fix to get fresh ranges
        }
      }
      
      if (!fixed) break; // No fixable diagnostics left
    }
    
    if (appliedFixes > 0) {
      // Final re-lint
      var updatedDoc = await vscode.workspace.openTextDocument(uri);
      await lintSingleFile(updatedDoc);
      vscode.window.showInformationMessage('Cursor Doctor: Applied ' + appliedFixes + ' fix' + (appliedFixes !== 1 ? 'es' : ''));
    } else {
      vscode.window.showInformationMessage('Cursor Doctor: No auto-fixable issues found');
    }
  } catch (e) {
    vscode.window.showErrorMessage('Fix all failed: ' + e.message);
  }
}

function showWelcomePanel() {
  var panel = vscode.window.createWebviewPanel(
    'cursorDoctorWelcome',
    'Welcome to Cursor Doctor',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = '<!DOCTYPE html><html><head><style>'
    + 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; color: #ccc; background: #1e1e1e; max-width: 680px; margin: 0 auto; }'
    + 'h1 { color: #4ec9b0; font-size: 28px; margin-bottom: 8px; }'
    + '.subtitle { color: #999; font-size: 16px; margin-bottom: 32px; }'
    + '.step { display: flex; align-items: flex-start; margin: 24px 0; padding: 16px; background: #252525; border-radius: 8px; border-left: 3px solid #4ec9b0; }'
    + '.step-num { background: #4ec9b0; color: #1e1e1e; font-weight: bold; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 16px; }'
    + '.step-content h3 { margin: 0 0 4px 0; color: #e0e0e0; font-size: 15px; }'
    + '.step-content p { margin: 0; color: #999; font-size: 13px; }'
    + 'code { background: #333; padding: 2px 6px; border-radius: 3px; font-size: 13px; color: #ce9178; }'
    + '.pro-badge { background: #569cd6; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: bold; margin-left: 8px; }'
    + '.cta { margin-top: 32px; text-align: center; }'
    + '.cta a { display: inline-block; background: #4ec9b0; color: #1e1e1e; text-decoration: none; padding: 10px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; }'
    + '.cta a:hover { background: #3db89e; }'
    + '.footer { margin-top: 32px; text-align: center; color: #666; font-size: 12px; }'
    + '</style></head><body>'
    + '<h1>🏥 Cursor Doctor</h1>'
    + '<div class="subtitle">Your Cursor AI setup, diagnosed and fixed.</div>'
    + '<div class="step"><div class="step-num">1</div><div class="step-content">'
    + '<h3>Check your health grade</h3>'
    + '<p>Look at the <strong>status bar</strong> (bottom left). You\'ll see a letter grade (A-F) for your Cursor setup. Click it to see the full report.</p>'
    + '</div></div>'
    + '<div class="step"><div class="step-num">2</div><div class="step-content">'
    + '<h3>Fix issues inline</h3>'
    + '<p>Open any <code>.mdc</code> file. Errors and warnings appear with squiggly underlines. Hover for details, or click the <strong>💡 lightbulb</strong> for quick fixes.</p>'
    + '</div></div>'
    + '<div class="step"><div class="step-num">3</div><div class="step-content">'
    + '<h3>Run a full scan</h3>'
    + '<p>Open the Command Palette (<code>Ctrl+Shift+P</code>) and run <code>Cursor Doctor: Scan Health</code> for a detailed breakdown of every check.</p>'
    + '</div></div>'
    + '<div class="step"><div class="step-num">4</div><div class="step-content">'
    + '<h3>Auto-fix everything <span class="pro-badge">PRO</span></h3>'
    + '<p>Run <code>Cursor Doctor: Auto-Fix</code> to repair frontmatter, merge redundant rules, resolve conflicts, and generate starter rules for your stack. One command, clean setup.</p>'
    + '</div></div>'
    + '<div class="cta"><a href="#" onclick="openExternal(\'' + PURCHASE_URL_BASE + '?utm_source=vscode&utm_medium=extension&utm_campaign=welcome-panel\')" style="display:inline-block; background:#4ec9b0; color:#1e1e1e; text-decoration:none; padding:10px 24px; border-radius:6px; font-weight:bold; font-size:14px; cursor:pointer;">Get Pro — $9 one-time</a></div>'
    + '<div class="footer">Free: scan, lint, diagnostics, migrate · Pro: auto-fix, generate, conflict resolution<br><br>'
    + '<a href="#" onclick="openExternal(\'https://github.com/nedcodes-ok/cursor-doctor\')" style="color:#569cd6; cursor:pointer;">GitHub</a> · '
    + '<a href="#" onclick="openExternal(\'https://www.npmjs.com/package/cursor-doctor\')" style="color:#569cd6; cursor:pointer;">npm</a></div>'
    + '<script>const vscode = acquireVsCodeApi(); function openExternal(url) { vscode.postMessage({ command: "openExternal", url: url }); }</script>'
    + '</body></html>';

  panel.webview.onDidReceiveMessage(function (message) {
    if (message.command === 'openExternal' && message.url) {
      vscode.env.openExternal(vscode.Uri.parse(message.url));
    }
  }, undefined, []);
}

function deactivate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (gradeUpdateTimer) clearTimeout(gradeUpdateTimer);
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (statusBarItem) statusBarItem.dispose();
  if (outputChannel) outputChannel.dispose();
}

module.exports = { activate, deactivate };
