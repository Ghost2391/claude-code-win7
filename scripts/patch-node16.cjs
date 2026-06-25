const fs = require('fs');
const path = require('path');

const dir = 'E:/code/cladue-win7/claude-code/dist/chunks';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

// Only patch: RegExp `v` flag -> `u` flag, RGI_Emoji -> Extended_Pictographic
// Node 18 natively supports: scheduler, getDefaultHighWaterMark, addAbortListener, aborted
let patched = 0;
for (const f of files) {
  const fp = path.join(dir, f);
  let c = fs.readFileSync(fp, 'utf8');
  let orig = c;
  // Template literal: \x60v\x60  (RegExp with v flag)
  c = c.replace(/\x60v\x60\)/g, '\x60u\x60)');
  // Double-quoted: RegExp("...", "v")
  c = c.replace(/RegExp\(([^,]+),"v"/g, 'RegExp($1,"u"');
  // Single-quoted: RegExp('...', 'v')
  c = c.replace(/RegExp\(([^,]+),'v'/g, "RegExp($1,'u'");
  // String-width uses RegExp(`^...$,`v`)
  c = c.replace(/RGI_Emoji/g, 'Extended_Pictographic');
  if (c !== orig) {
    fs.writeFileSync(fp, c, 'utf8');
    patched++;
    console.log('Patched:', f);
  }
}
console.log('Regex patches:', patched);

// Verify
let remaining = 0;
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), 'utf8');
  if (/\x60v\x60\)/.test(c) || /RegExp\([^,]+,"v"/.test(c) || /RegExp\([^,]+,'v'/.test(c)) {
    console.log('WARN: remaining v flag in', f);
    remaining++;
  }
}
if (remaining === 0) console.log('All clear');
