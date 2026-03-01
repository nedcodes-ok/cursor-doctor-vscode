const vscode = require('vscode');
const { isLicensed } = require('./license');

const PURCHASE_URL = 'https://nedcodes.gumroad.com/l/cursor-doctor-pro?utm_source=vscode&utm_medium=extension&utm_campaign=codeaction';

class CursorDoctorCodeActionProvider {
  provideCodeActions(document, range, context) {
    var actions = [];
    var folders = vscode.workspace.workspaceFolders;
    var dir = folders ? folders[0].uri.fsPath : '';
    var licensed = isLicensed(dir);

    for (var i = 0; i < context.diagnostics.length; i++) {
      var diag = context.diagnostics[i];
      if (diag.source !== 'cursor-doctor') continue;

      var code = diag.code;
      if (!code) continue;

      if (licensed) {
        var fixes = getFixesForCode(code, document, diag);
        for (var j = 0; j < fixes.length; j++) {
          actions.push(fixes[j]);
        }
      } else {
        // Show Pro upsell action instead of actual fix
        var proAction = new vscode.CodeAction(
          '🔒 Auto-fix: ' + code + ' (Pro)',
          vscode.CodeActionKind.QuickFix
        );
        proAction.diagnostics = [diag];
        proAction.command = {
          command: 'vscode.open',
          title: 'Get Pro',
          arguments: [vscode.Uri.parse(PURCHASE_URL)]
        };
        actions.push(proAction);
      }
    }

    // Add "Fix all issues in this file" action if there are any diagnostics
    var fileDiagnostics = context.diagnostics.filter(function (d) { return d.source === 'cursor-doctor'; });
    if (fileDiagnostics.length > 0) {
      var fixAllAction = new vscode.CodeAction(
        licensed ? 'Fix all issues in this file' : '🔒 Fix all issues in this file (Pro)',
        vscode.CodeActionKind.QuickFix
      );
      fixAllAction.diagnostics = fileDiagnostics;
      fixAllAction.command = {
        command: 'cursorDoctor.fixAllInFile',
        title: 'Fix All Issues',
        arguments: [document.uri]
      };
      actions.push(fixAllAction);
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

    case 'boolean-string': {
      // Fix "true" / "false" to true / false (case-insensitive)
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        var yaml = fmMatch[1];
        var fixedYaml = yaml.replace(/^(alwaysApply:\s*)["']?(true|false)["']?\s*$/gmi, function(match, prefix, value) {
          return prefix + value.toLowerCase();
        });
        
        if (fixedYaml !== yaml) {
          var action = new vscode.CodeAction(
            'Fix boolean strings to boolean values',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
      break;
    }

    case 'tabs-in-frontmatter': {
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch && fmMatch[1].includes('\t')) {
        var yaml = fmMatch[1];
        var lines = yaml.split('\n');
        var fixed = lines.map(function(line) {
          return line.replace(/^(\w+):\t+/g, '$1: ').replace(/\t/g, '  ');
        }).join('\n');
        
        var action = new vscode.CodeAction(
          'Replace tabs with spaces in frontmatter',
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diag];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        
        var fmStartLine = 0;
        var fmEndLine = findFrontmatterEndLine(text);
        var range = new vscode.Range(
          new vscode.Position(fmStartLine, 0),
          new vscode.Position(fmEndLine, 0)
        );
        action.edit.replace(document.uri, range, '---\n' + fixed + '\n---\n');
        actions.push(action);
      }
      break;
    }

    case 'please-thank-you': {
      // Remove please/thank you from the document
      var action = new vscode.CodeAction(
        'Remove please/thank you',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var lines = text.split('\n');
      var fixedLines = lines.map(function(line) {
        var trimmed = line.trim();
        
        // Lines that are ONLY "Thank you" / "Thanks" — remove entirely
        if (/^thank\s*(you|s)[.!]?\s*$/i.test(trimmed)) {
          return null;
        }
        
        // Standalone politeness lines like "Please note:" or just "Please" — remove
        if (/^please[.!:]?\s*$/i.test(trimmed)) {
          return null;
        }
        
        // "Please X" at start of line where X is an imperative → "X" (capitalize first word)
        if (/^please\s+/i.test(trimmed)) {
          var rest = trimmed.replace(/^please\s+/i, '');
          return line.replace(trimmed, rest.charAt(0).toUpperCase() + rest.slice(1));
        }
        
        // "X please" at end → "X" (but only if it's clearly at the end)
        if (/\s+please[.!]?\s*$/i.test(trimmed)) {
          return line.replace(/,?\s+please([.!]?)\s*$/i, '$1');
        }
        
        // Inline "please " → remove just the word
        if (/\bplease\s+/i.test(line)) {
          return line.replace(/\bplease\s+/gi, '');
        }
        
        return line;
      }).filter(function(l) { return l !== null; });
      
      var fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0)
      );
      action.edit.replace(document.uri, fullRange, fixedLines.join('\n'));
      actions.push(action);
      break;
    }

    case 'first-person': {
      // Remove first person language
      var action = new vscode.CodeAction(
        'Remove first person language',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var lines = text.split('\n');
      var fixedLines = lines.map(function(line) {
        var patterns = [
          /^(\s*)I want you to\s+/i,
          /^(\s*)I need you to\s+/i,
          /^(\s*)I'd like you to\s+/i,
          /^(\s*)My preference is (to\s+)?/i,
        ];
        
        for (var p = 0; p < patterns.length; p++) {
          var match = line.match(patterns[p]);
          if (match) {
            var indent = match[1] || '';
            var rest = line.slice(match[0].length);
            return indent + rest.charAt(0).toUpperCase() + rest.slice(1);
          }
        }
        return line;
      });
      
      var fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0)
      );
      action.edit.replace(document.uri, fullRange, fixedLines.join('\n'));
      actions.push(action);
      break;
    }

    case 'trailing-whitespace': {
      var action = new vscode.CodeAction(
        'Remove trailing whitespace',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var lines = text.split('\n');
      var fixedLines = lines.map(function(line) {
        return line.trimEnd();
      });
      
      var fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0)
      );
      action.edit.replace(document.uri, fullRange, fixedLines.join('\n'));
      actions.push(action);
      break;
    }

    case 'excessive-blank-lines': {
      var action = new vscode.CodeAction(
        'Collapse excessive blank lines',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var fixed = text.replace(/\n\n\n+/g, '\n\n');
      
      var fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0)
      );
      action.edit.replace(document.uri, fullRange, fixed);
      actions.push(action);
      break;
    }

    case 'html-comments': {
      var action = new vscode.CodeAction(
        'Remove HTML comments',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var fixed = text.replace(/<!--[\s\S]*?-->/g, '');
      
      var fullRange = new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(document.lineCount, 0)
      );
      action.edit.replace(document.uri, fullRange, fixed);
      actions.push(action);
      break;
    }

    case 'glob-backslashes': {
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        var yaml = fmMatch[1];
        var lines = yaml.split('\n');
        var fixedLines = lines.map(function(line) {
          if (line.trim().startsWith('-') && line.includes('\\')) {
            return line.replace(/\\/g, '/');
          }
          return line;
        });
        
        var fixedYaml = fixedLines.join('\n');
        if (fixedYaml !== yaml) {
          var action = new vscode.CodeAction(
            'Replace backslashes with forward slashes in globs',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
      break;
    }

    case 'glob-trailing-slash': {
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        var yaml = fmMatch[1];
        var fixedYaml = yaml.replace(/^(\s*-\s*"[^"]*?)\/("\s*)$/gm, '$1$2');
        fixedYaml = fixedYaml.replace(/("[^"]*?)\/("[\s,\]])/g, '$1$2');
        
        if (fixedYaml !== yaml) {
          var action = new vscode.CodeAction(
            'Remove trailing slashes from globs',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
      break;
    }

    case 'glob-dot-prefix': {
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        var yaml = fmMatch[1];
        var fixedYaml = yaml.replace(/^(\s*-\s*")\.\//gm, '$1');
        fixedYaml = fixedYaml.replace(/(globs:\s*")\.\//g, '$1');
        
        if (fixedYaml !== yaml) {
          var action = new vscode.CodeAction(
            'Remove ./ prefix from globs',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
      break;
    }

    case 'unclosed-code-block': {
      var action = new vscode.CodeAction(
        'Add closing code block marker',
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.edit = new vscode.WorkspaceEdit();
      
      var lastLine = document.lineCount - 1;
      var lastLineText = document.lineAt(lastLine).text;
      var insertion = lastLineText.length > 0 ? '\n```' : '```';
      
      action.edit.insert(document.uri, new vscode.Position(lastLine, lastLineText.length), insertion);
      actions.push(action);
      break;
    }

    case 'description-has-markdown': {
      var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        var yaml = fmMatch[1];
        var descLine = yaml.match(/^description:\s*(.+)$/m);
        
        if (descLine && /[*_`#\[\]]/.test(descLine[1])) {
          var cleanDesc = descLine[1].replace(/[*_`#\[\]]/g, '');
          var fixedYaml = yaml.replace(/^description:.*$/m, 'description: ' + cleanDesc);
          
          var action = new vscode.CodeAction(
            'Remove markdown formatting from description',
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
      break;
    }

    case 'unknown-frontmatter-key': {
      // Extract the unknown key from the diagnostic message
      var keyMatch = diag.message.match(/Unknown frontmatter key: (\w+)/);
      if (keyMatch) {
        var unknownKey = keyMatch[1];
        var fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
        
        if (fmMatch) {
          var yaml = fmMatch[1];
          var lines = yaml.split('\n');
          var filteredLines = lines.filter(function(line) {
            var colonIdx = line.indexOf(':');
            if (colonIdx === -1) return true;
            var key = line.slice(0, colonIdx).trim();
            return key !== unknownKey;
          });
          
          var fixedYaml = filteredLines.join('\n');
          
          var action = new vscode.CodeAction(
            'Remove unknown frontmatter key: ' + unknownKey,
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diag];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          
          var fmStartLine = 0;
          var fmEndLine = findFrontmatterEndLine(text);
          var range = new vscode.Range(
            new vscode.Position(fmStartLine, 0),
            new vscode.Position(fmEndLine, 0)
          );
          action.edit.replace(document.uri, range, '---\n' + fixedYaml + '\n---\n');
          actions.push(action);
        }
      }
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
