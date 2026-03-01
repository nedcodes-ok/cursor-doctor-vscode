// Auto-fix functions for cursor-doctor VS Code extension
// Each function takes content string and returns { content, changes }

const { parseFrontmatter } = require('./linter');

// 1. Fix boolean strings: "true" → true, "false" → false
function fixBooleanStrings(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  let modified = false;
  
  // Fix alwaysApply: "true" or "false"
  if (fm.data.alwaysApply && typeof fm.data.alwaysApply === 'string') {
    if (fm.data.alwaysApply === 'true' || fm.data.alwaysApply === 'false') {
      yaml = yaml.replace(/^alwaysApply:\s*["']?(true|false)["']?$/m, 'alwaysApply: $1');
      changes.push('Fixed boolean string in alwaysApply');
      modified = true;
    }
  }
  
  if (modified) {
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
  }
  
  return { content, changes };
}

// 2. Fix frontmatter tabs: replace tabs with spaces
function fixFrontmatterTabs(content) {
  const changes = [];
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  
  if (!match) return { content, changes };
  
  const yaml = match[1];
  if (yaml.includes('\t')) {
    const lines = yaml.split('\n');
    const fixed = lines.map(line => {
      return line.replace(/^(\w+):\t+/g, '$1: ').replace(/\t/g, '  ');
    }).join('\n');
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${fixed}\n---`);
    changes.push('Replaced tabs with spaces in frontmatter');
  }
  
  return { content, changes };
}

// 3. Fix comma-separated globs: convert to YAML array
function fixCommaSeparatedGlobs(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  
  // Match globs: "*.ts, *.tsx" pattern (comma-separated string)
  const globMatch = yaml.match(/^globs:\s*["']([^"']*,\s*[^"']*)["']\s*$/m);
  if (globMatch) {
    const globString = globMatch[1];
    const globs = globString.split(',').map(g => g.trim()).filter(g => g.length > 0);
    
    const yamlArray = globs.map(g => `  - "${g}"`).join('\n');
    yaml = yaml.replace(/^globs:.*$/m, `globs:\n${yamlArray}`);
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
    changes.push('Converted comma-separated globs to YAML array');
  }
  
  return { content, changes };
}

// 4. Fix empty globs array: remove the globs line
function fixEmptyGlobsArray(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  
  if (/^globs:\s*\[\s*\]\s*$/m.test(yaml)) {
    yaml = yaml.replace(/^globs:\s*\[\s*\]\s*\n?/m, '');
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
    changes.push('Removed empty globs array');
  }
  
  return { content, changes };
}

// 5. Fix description with markdown: strip *, _, `, #, [, ]
function fixDescriptionMarkdown(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.description) return { content, changes };
  
  const desc = fm.data.description;
  if (/[*_`#\[\]]/.test(desc)) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { content, changes };
    
    let yaml = match[1];
    const cleanDesc = desc.replace(/[*_`#\[\]]/g, '');
    
    yaml = yaml.replace(/^description:.*$/m, `description: ${cleanDesc}`);
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
    changes.push('Removed markdown formatting from description');
  }
  
  return { content, changes };
}

// 6. Fix unknown frontmatter keys: remove unknown keys
function fixUnknownFrontmatterKeys(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data) return { content, changes };
  
  const validKeys = ['description', 'globs', 'alwaysApply'];
  const unknownKeys = Object.keys(fm.data).filter(k => !validKeys.includes(k));
  
  if (unknownKeys.length === 0) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  const lines = yaml.split('\n');
  const filteredLines = [];
  
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      filteredLines.push(line);
      continue;
    }
    
    const key = line.slice(0, colonIdx).trim();
    if (validKeys.includes(key) || !key) {
      filteredLines.push(line);
    } else {
      changes.push(`Removed unknown frontmatter key: ${key}`);
    }
  }
  
  yaml = filteredLines.join('\n');
  content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
  
  return { content, changes };
}

// 7. Fix description contains "rule": strip "Rule for " or "Rules for "
function fixDescriptionRule(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.description) return { content, changes };
  
  const desc = fm.data.description;
  const patterns = [/^Rules?\s+for\s+/i, /^Rules?:\s*/i];
  
  for (const pattern of patterns) {
    if (pattern.test(desc)) {
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) return { content, changes };
      
      let yaml = match[1];
      const cleanDesc = desc.replace(pattern, '');
      
      yaml = yaml.replace(/^description:.*$/m, `description: ${cleanDesc}`);
      content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
      changes.push('Removed redundant "Rule for" from description');
      break;
    }
  }
  
  return { content, changes };
}

// 8. Fix excessive blank lines: collapse 3+ to 2
function fixExcessiveBlankLines(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  
  if (/\n\n\n\n/.test(body)) {
    body = body.replace(/\n\n\n+/g, '\n\n');
    content = frontmatter + body;
    changes.push('Collapsed excessive blank lines');
  }
  
  return { content, changes };
}

// 9. Fix trailing whitespace: trim trailing spaces/tabs from each line
function fixTrailingWhitespace(content) {
  const changes = [];
  const lines = content.split('\n');
  let modified = false;
  
  const fixedLines = lines.map(line => {
    if (line !== line.trimEnd()) {
      modified = true;
      return line.trimEnd();
    }
    return line;
  });
  
  if (modified) {
    content = fixedLines.join('\n');
    changes.push('Removed trailing whitespace');
  }
  
  return { content, changes };
}

// 10. Fix please/thank you: remove polite language
function fixPleaseThankYou(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  let modified = false;
  
  const lines = body.split('\n');
  const fixedLines = lines.map(line => {
    const trimmed = line.trim();
    
    // Lines starting with "Thank you" / "Thanks" — remove entirely
    if (/^thank\s*(you|s)\b/i.test(trimmed)) {
      modified = true;
      return null;
    }
    
    // "Please X" at start of line → "X" (capitalize first word)
    if (/^please\s+/i.test(trimmed)) {
      modified = true;
      const rest = trimmed.replace(/^please\s+/i, '');
      return line.replace(trimmed, rest.charAt(0).toUpperCase() + rest.slice(1));
    }
    
    // "X please" at end → "X"
    if (/\s+please[.!]?\s*$/i.test(trimmed)) {
      modified = true;
      return line.replace(/,?\s+please([.!]?)\s*$/i, '$1');
    }
    
    return line;
  }).filter(l => l !== null);
  
  if (modified) {
    body = fixedLines.join('\n');
    content = frontmatter + body;
    changes.push('Removed please/thank you');
  }
  
  return { content, changes };
}

// 11. Fix first person: "I want you to use X" → "Use X"
function fixFirstPerson(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  let modified = false;
  
  const lines = body.split('\n');
  const fixedLines = lines.map(line => {
    const patterns = [
      /^(\s*)I want you to\s+/i,
      /^(\s*)I need you to\s+/i,
      /^(\s*)I'd like you to\s+/i,
      /^(\s*)My preference is (to\s+)?/i,
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        modified = true;
        const indent = match[1] || '';
        const rest = line.slice(match[0].length);
        return indent + rest.charAt(0).toUpperCase() + rest.slice(1);
      }
    }
    return line;
  });
  
  if (modified) {
    body = fixedLines.join('\n');
    content = frontmatter + body;
    changes.push('Removed first person language');
  }
  
  return { content, changes };
}

// 12. Fix commented-out HTML: remove <!-- --> blocks
function fixCommentedHTML(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  
  if (/<!--[\s\S]*?-->/.test(body)) {
    body = body.replace(/<!--[\s\S]*?-->/g, '');
    content = frontmatter + body;
    changes.push('Removed commented-out HTML sections');
  }
  
  return { content, changes };
}

// 13. Fix unclosed code blocks: add closing ``` if odd count
function fixUnclosedCodeBlocks(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  
  const markers = body.match(/```/g);
  if (markers && markers.length % 2 !== 0) {
    body += '\n```';
    content = frontmatter + body;
    changes.push('Added closing code block marker');
  }
  
  return { content, changes };
}

// 14. Fix inconsistent list markers: normalize to -
function fixInconsistentListMarkers(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found) return { content, changes };
  
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fmMatch) return { content, changes };
  
  const frontmatter = fmMatch[0];
  let body = content.slice(frontmatter.length);
  
  // Check if mixing -, *, +
  const hasDash = /^\s*-\s+/m.test(body);
  const hasStar = /^\s*\*\s+/m.test(body);
  const hasPlus = /^\s*\+\s+/m.test(body);
  
  const markerCount = [hasDash, hasStar, hasPlus].filter(Boolean).length;
  
  if (markerCount > 1) {
    // Normalize all to -
    body = body.replace(/^(\s*)\*(\s+)/gm, '$1-$2');
    body = body.replace(/^(\s*)\+(\s+)/gm, '$1-$2');
    content = frontmatter + body;
    changes.push('Normalized list markers to -');
  }
  
  return { content, changes };
}

// 15. Fix backslashes in globs: replace \ with /
function fixGlobBackslashes(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.globs) return { content, changes };
  
  const globs = Array.isArray(fm.data.globs) ? fm.data.globs : [fm.data.globs];
  const hasBackslash = globs.some(g => typeof g === 'string' && g.includes('\\'));
  
  if (!hasBackslash) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  
  const lines = yaml.split('\n');
  const fixedLines = lines.map(line => {
    if (line.trim().startsWith('-') && line.includes('\\')) {
      return line.replace(/\\/g, '/');
    }
    return line;
  });
  
  yaml = fixedLines.join('\n');
  content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
  changes.push('Replaced backslashes with forward slashes in globs');
  
  return { content, changes };
}

// 16. Fix trailing slash in globs: remove trailing /
function fixGlobTrailingSlash(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.globs) return { content, changes };
  
  const globs = Array.isArray(fm.data.globs) ? fm.data.globs : [fm.data.globs];
  const hasTrailing = globs.some(g => typeof g === 'string' && g.endsWith('/'));
  
  if (!hasTrailing) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  yaml = yaml.replace(/^(\s*-\s*"[^"]*?)\/("\s*)$/gm, '$1$2');
  yaml = yaml.replace(/("[^"]*?)\/("[\s,\]])/g, '$1$2');
  
  content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
  changes.push('Removed trailing slashes from globs');
  
  return { content, changes };
}

// 17. Fix ./ prefix in globs: remove leading ./
function fixGlobDotSlash(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.globs) return { content, changes };
  
  const globs = Array.isArray(fm.data.globs) ? fm.data.globs : [fm.data.globs];
  const hasDotSlash = globs.some(g => typeof g === 'string' && g.startsWith('./'));
  
  if (!hasDotSlash) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  yaml = yaml.replace(/^(\s*-\s*")\.\//gm, '$1');
  yaml = yaml.replace(/(globs:\s*")\.\//g, '$1');
  
  content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
  changes.push('Removed ./ prefix from globs');
  
  return { content, changes };
}

// 18. Fix regex syntax in globs: \.ts$ → *.ts
function fixGlobRegexSyntax(content) {
  const changes = [];
  const fm = parseFrontmatter(content);
  
  if (!fm.found || !fm.data || !fm.data.globs) return { content, changes };
  
  const globs = Array.isArray(fm.data.globs) ? fm.data.globs : [fm.data.globs];
  const hasRegex = globs.some(g => typeof g === 'string' && (/\\\./.test(g) || /\$$/.test(g) || /^\^/.test(g)));
  
  if (!hasRegex) return { content, changes };
  
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { content, changes };
  
  let yaml = match[1];
  let modified = false;
  
  const lines = yaml.split('\n');
  const fixedLines = lines.map(line => {
    if (!line.includes('"') || (!line.includes('\\.') && !line.includes('$'))) return line;
    
    return line.replace(/"([^"]+)"/g, (fullMatch, glob) => {
      let fixed = glob;
      fixed = fixed.replace(/^\\\.([\w]+)\$?$/, '*.$1');
      fixed = fixed.replace(/^\^/, '');
      fixed = fixed.replace(/\$$/, '');
      
      if (fixed !== glob) {
        modified = true;
        return `"${fixed}"`;
      }
      return fullMatch;
    });
  });
  
  if (modified) {
    yaml = fixedLines.join('\n');
    content = content.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`);
    changes.push('Converted regex syntax to glob syntax');
  }
  
  return { content, changes };
}

module.exports = {
  fixBooleanStrings,
  fixFrontmatterTabs,
  fixCommaSeparatedGlobs,
  fixEmptyGlobsArray,
  fixDescriptionMarkdown,
  fixUnknownFrontmatterKeys,
  fixDescriptionRule,
  fixExcessiveBlankLines,
  fixTrailingWhitespace,
  fixPleaseThankYou,
  fixFirstPerson,
  fixCommentedHTML,
  fixUnclosedCodeBlocks,
  fixInconsistentListMarkers,
  fixGlobBackslashes,
  fixGlobTrailingSlash,
  fixGlobDotSlash,
  fixGlobRegexSyntax,
};
