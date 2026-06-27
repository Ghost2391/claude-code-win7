const fs = require('fs');
const path = require('path');

// Also patch the main cli.js and chunk files
const dirs = [
  'dist/chunks',
  'dist',  // for cli.js
];

function patchDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  let patched = 0;

  for (const f of files) {
    const fp = path.join(dir, f);
    let c = fs.readFileSync(fp, 'utf8');
    let orig = c;

    // RegExp `v` flag -> `u` flag
    c = c.replace(/\x60v\x60\)/g, '\x60u\x60)');
    c = c.replace(/RegExp\(([^,]+),"v"/g, 'RegExp($1,"u"');
    c = c.replace(/RegExp\(([^,]+),'v'/g, "RegExp($1,'u'");
    c = c.replace(/RGI_Emoji/g, 'Extended_Pictographic');

    // nodeImports: Rolldown missing export
    c = c.replace(
      /Object\.assign\(nodeImports,{/g,
      '(globalThis.nodeImports??={}),Object.assign(globalThis.nodeImports,{',
    );

    // Node 18 compat: stream.on is not exported (added in Node 20).
    // 'on' is available as 'cn' from node:events (imported as `on as cn`).
    // 'finished' from node:stream needs a named import since it's not in scope.
    const fnAlias = 'zzzFn';
    // Import finished from node:stream — use regex since minifier renames variable
    // Negative lookahead prevents double-adding on re-run
    c = c.replace(
      /import\{text as [\w$]+\}from"node:stream\/consumers";(?!\s*import\{finished as [\w$]+\}from"node:stream")/,
      match => match + 'import{finished as ' + fnAlias + '}from"node:stream";'
    );
    // Fix Object.assign — use regex since minifier renames on$2, finished$3
    c = c.replace(
      /Object\.assign\(globalThis\.nodeImports,\{on:[\w$]+,finished:[\w$]+\}\)/,
      'Object.assign(globalThis.nodeImports,{on:cn,finished:' + fnAlias + '})'
    );

    if (c !== orig) {
      fs.writeFileSync(fp, c, 'utf8');
      patched++;
      console.log('Patched:', f);
    }
  }
  return patched;
}

let total = 0;
for (const dir of dirs) {
  total += patchDir(dir);
}
console.log('Total patches:', total);

// Verify v flag
let remaining = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\x60v\x60\)/.test(c) || /RegExp\([^,]+,"v"/.test(c) || /RegExp\([^,]+,'v'/.test(c)) {
      console.log('WARN: remaining v flag in', f);
      remaining++;
    }
  }
}
if (remaining === 0) console.log('All clear (v flag)');

// Verify stream.on fix: cn and zzzFn must exist if nodeImports was patched
let verifyFail = 0;
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const c = fs.readFileSync(path.join(dir, f), 'utf8');
    // If file has globalThis.nodeImports, it should also have cn and zzzFn
    if (c.includes('globalThis.nodeImports')) {
      if (!c.includes(',finished:zzzFn})')) {
        console.error('FAIL: stream.on fix missing cn/zzzFn in', f);
        verifyFail++;
      }
    }
  }
}
if (verifyFail > 0) {
  console.error(`VERIFY FAILED: ${verifyFail} files missing cn/zzzFn after patch`);
  process.exit(1);
}
console.log('All clear (stream.on fix)');
