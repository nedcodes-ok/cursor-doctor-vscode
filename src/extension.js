const vscode = require('vscode');
const path = require('path');
const { lintProject, lintMdcFile, lintCursorrules } = require('./linter');
const { doctor } = require('./doctor');
const { autoFix } = require('./autofix');
const { migrate } = require('./migrate');
const { isLicensed, activateLicense } = require('./license');

const PURCHASE_URL = 'https://nedcodes.gumroad.com/l/cursor-doctor-pro';

let diagnosticCollection;
let statusBarItem;
let lastReport = null;

function activate(context) {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('cursor-doctor');
  context.subscriptions.push(diagnosticCollection);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'cursorDoctor.scan';
  statusBarItem.tooltip = 'Click to run Cursor Doctor scan';
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorDoctor.scan', cmdScan),
    vscode.commands.registerCommand('cursorDoctor.lint', cmdLint),
    vscode.commands.registerCommand('cursorDoctor.fix', cmdFix),
    vscode.commands.registerCommand('cursorDoctor.migrate', cmdMigrate),
    vscode.commands.registerCommand('cursorDoctor.generate', cmdGenerate),
    vscode.commands.registerCommand('cursorDoctor.activate', cmdActivate)
  );

  // Lint on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(function (doc) {
      if (doc.fileName.endsWith('.mdc') || doc.fileName.endsWith('.cursorrules')) {
        lintSingleFile(doc);
        updateHealthGrade();
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

  // Run scan on activation
  updateHealthGrade();
  lintWorkspace();
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

    var icons = { A: '$(pass)', B: '$(pass)', C: '$(warning)', D: '$(warning)', F: '$(error)' };
    var icon = icons[report.grade] || '$(info)';
    statusBarItem.text = icon + ' Cursor: ' + report.grade + ' (' + report.percentage + '%)';

    if (report.grade === 'A' || report.grade === 'B') {
      statusBarItem.backgroundColor = undefined;
    } else if (report.grade === 'C') {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }

    statusBarItem.show();
  } catch (e) {
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
    { enableScripts: false }
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
    + (fixable > 0 ? '<div class="pro">💡 <strong>Auto-fix available</strong> — Run <code>Cursor Doctor: Auto-Fix</code> from the command palette.<br><span style="color:#999; font-size:12px;">Pro license required ($9 one-time) — <a href="' + PURCHASE_URL + '" style="color:#569cd6">' + PURCHASE_URL + '</a></span></div>' : '')
    + '</body></html>';
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
    } catch (e) { /* skip */ }
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
  return issues.map(function (issue) {
    var line = issue.line ? issue.line - 1 : 0;
    var maxLine = document.lineCount - 1;
    if (line > maxLine) line = maxLine;
    var range = new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, document.lineAt(line).text.length)
    );

    var severity = issue.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;

    var diagnostic = new vscode.Diagnostic(range, issue.message, severity);
    diagnostic.source = 'cursor-doctor';

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
      vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL));
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
      vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL));
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

function deactivate() {
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (statusBarItem) statusBarItem.dispose();
}

module.exports = { activate, deactivate };
