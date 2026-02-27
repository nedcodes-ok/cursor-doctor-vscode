const vscode = require('vscode');

const PURCHASE_URL = 'https://nedcodes.gumroad.com/l/cursor-doctor-pro';

class CursorDoctorCodeActionProvider {
  provideCodeActions(document, range, context) {
    var actions = [];

    for (var i = 0; i < context.diagnostics.length; i++) {
      var diag = context.diagnostics[i];
      if (diag.source !== 'cursor-doctor') continue;

      var code = diag.code;
      if (!code) continue;

      var fixes = getFixesForCode(code, document, diag);
      for (var j = 0; j < fixes.length; j++) {
        actions.push(fixes[j]);
      }
    }

    return actions;
  }
}

CursorDoctorCodeActionProvider.metadata = {
  providedCodeActionKinds: [
    vscode.CodeActionKind.QuickFix
  ]
};

function getFixesForCode(code, document, diag) {
  var actions = [];
  var text = document.getText();

  switch (code) {
    case 'missing-frontmatter': {
      var action = new vscode.CodeAction(
        'Add frontmatter template',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      var snippet = '---\ndescription: \nalwaysApply: true\n---\n';
      action.edit = new vscode.WorkspaceEdit();
      action.edit.insert(document.uri, new vscode.Position(0, 0), snippet);
      actions.push(action);
      break;
    }

    case 'missing-alwaysapply': {
      var fmEnd = findFrontmatterEndLine(text);
      if (fmEnd >= 0) {
        var action = new vscode.CodeAction(
          'Add alwaysApply: true',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diag];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.insert(document.uri, new vscode.Position(fmEnd, 0), 'alwaysApply: true\n');
        actions.push(action);
      }
      break;
    }

    case 'missing-description': {
      var fmEnd = findFrontmatterEndLine(text);
      if (fmEnd >= 0) {
        var action = new vscode.CodeAction(
          'Add description field',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diag];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.insert(document.uri, new vscode.Position(fmEnd, 0), 'description: \n');
        actions.push(action);
      }
      break;
    }

    case 'globs-not-array': {
      var globLine = findLineWith(text, 'globs:');
      if (globLine >= 0) {
        var line = document.lineAt(globLine);
        var match = line.text.match(/^globs:\s*(.+)$/);
        if (match) {
          var parts = match[1].split(',').map(function(s) { return s.trim().replace(/['"]/g, ''); });
          var replacement = 'globs:\n';
          for (var k = 0; k < parts.length; k++) {
            if (parts[k]) replacement += '  - "' + parts[k] + '"\n';
          }
          var action = new vscode.CodeAction(
            'Convert globs to YAML array',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, line.range, replacement.trimEnd());
          actions.push(action);
        }
      }
      break;
    }

    case 'empty-body': {
      var action = new vscode.CodeAction(
        'Add rule template',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.edit = new vscode.WorkspaceEdit();
      var lastLine = document.lineCount - 1;
      var template = '\n# Rule Name\n\n## Instructions\n\n- Your rule instructions here\n\n## Examples\n\n```\n// good example\n```\n';
      action.edit.insert(document.uri, new vscode.Position(lastLine + 1, 0), template);
      actions.push(action);
      break;
    }

    case 'legacy-cursorrules': {
      var action = new vscode.CodeAction(
        'Migrate to .mdc format',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.command = {
        command: 'cursorDoctor.migrate',
        title: 'Migrate .cursorrules to .mdc'
      };
      actions.push(action);
      break;
    }

    case 'alwaysapply-with-globs': {
      // Remove globs since alwaysApply is true
      var globLine = findLineWith(text, 'globs:');
      if (globLine >= 0) {
        var action = new vscode.CodeAction(
          'Remove globs (alwaysApply handles matching)',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diag];
        action.edit = new vscode.WorkspaceEdit();
        // Find extent of globs (may be multi-line array)
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
        actions.push(action);
      }
      break;
    }

    case 'broad-glob': {
      var globLine = findLineWith(text, 'globs:');
      if (globLine >= 0) {
        var action = new vscode.CodeAction(
          'Switch to alwaysApply: true instead',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diag];
        action.edit = new vscode.WorkspaceEdit();
        // Remove glob lines and add alwaysApply if not present
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
        if (text.indexOf('alwaysApply:') === -1) {
          action.edit.replace(document.uri, range, 'alwaysApply: true\n');
        } else {
          action.edit.delete(document.uri, range);
        }
        actions.push(action);
      }
      break;
    }

    case 'body-just-url': {
      var action = new vscode.CodeAction(
        'Add instructions (Cursor can\'t follow URLs)',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.edit = new vscode.WorkspaceEdit();
      var lastLine = document.lineCount - 1;
      action.edit.insert(
        document.uri,
        new vscode.Position(lastLine + 1, 0),
        '\n## Instructions\n\n- Replace this URL with the actual instructions from that page\n- Cursor cannot follow links\n'
      );
      actions.push(action);
      break;
    }
  }

  // For any fixable issue, also offer "Fix all with Auto-Fix (Pro)"
  if (actions.length > 0) {
    var proAction = new vscode.CodeAction(
      'Fix all issues with Auto-Fix (Pro)',
      vscode.CodeActionKind.QuickFix
    );
    proAction.diagnostics = [diag];
    proAction.command = {
      command: 'cursorDoctor.fix',
      title: 'Auto-Fix (Pro)'
    };
    actions.push(proAction);
  }

  return actions;
}

function findFrontmatterEndLine(text) {
  var lines = text.split('\n');
  if (lines[0] !== '---') return -1;
  for (var i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return i;
  }
  return -1;
}

function findLineWith(text, needle) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(needle) === 0) return i;
  }
  return -1;
}

module.exports = { CursorDoctorCodeActionProvider };
