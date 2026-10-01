import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateTheme } from './check-contrast.mjs';

const checker = fileURLToPath(new URL('./check-contrast.mjs', import.meta.url));

function loadTheme(name = 'harpy-noct') {
  return JSON.parse(readFileSync(new URL(`../themes/${name}.json`, import.meta.url), 'utf8'));
}

test('CLI accepts both bundled themes', () => {
  const output = execFileSync(process.execPath, [checker], { encoding: 'utf8' });
  assert.equal(output.trim(), 'All contrast checks passed.');
});

for (const name of ['harpy-noct', 'harpy-insone']) {
  test(`accepts valid ${name} colors`, () => {
    assert.deepEqual(validateTheme(loadTheme(name)), []);
  });
}

test('accepts chained foreground variable references', () => {
  const theme = loadTheme();
  theme.vars.textAlias = 'foreground';
  theme.colors.text = 'textAlias';
  assert.deepEqual(validateTheme(theme), []);
});

test('rejects a malformed background instead of accepting NaN contrast', () => {
  const theme = loadTheme();
  theme.vars.background = '#zzzzzz';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*background/.test(issue)));
});

for (const background of ['background', 'surface', 'surfaceAlt', 'selection', 'surfaceSuccess', 'surfaceError']) {
  test(`rejects missing ${background}`, () => {
    const theme = loadTheme();
    delete theme.vars[background];
    assert.ok(validateTheme(theme).some((issue) => issue.includes(background)));
  });
}

for (const value of [null, 42, '', '#12345g', '#fff']) {
  test(`rejects invalid background ${JSON.stringify(value)}`, () => {
    const theme = loadTheme();
    theme.vars.background = value;
    assert.ok(validateTheme(theme).some((issue) => /invalid: .*background/.test(issue)));
  });
}

test('rejects an array that coerces to a valid hex string', () => {
  const theme = loadTheme();
  theme.vars.background = [theme.vars.background];
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*background/.test(issue)));
});

test('rejects a self-referencing variable without overflowing the stack', () => {
  const theme = loadTheme();
  theme.vars.comment = 'comment';
  assert.ok(validateTheme(theme).some((issue) => /cycle: .*comment/.test(issue)));
});

test('rejects an invalid color outside contrast rules', () => {
  const theme = loadTheme();
  theme.colors.accent = '#zzzzzz';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*accent/.test(issue)));
});

test('rejects a cycle between unused variables', () => {
  const theme = loadTheme();
  theme.vars.unusedA = 'unusedB';
  theme.vars.unusedB = 'unusedA';
  assert.ok(validateTheme(theme).some((issue) => /cycle: .*unused/.test(issue)));
});

test('rejects a malformed export background instead of accepting NaN contrast', () => {
  const theme = loadTheme();
  theme.export.infoBg = '#zzzzzz';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*export.infoBg/.test(issue)));
});

test('rejects an invalid export color outside contrast rules', () => {
  const theme = loadTheme();
  theme.export.pageBg = '#zzzzzz';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*export.pageBg/.test(issue)));
});

test('rejects an invalid unused variable', () => {
  const theme = loadTheme();
  theme.vars.unused = '#zzzzzz';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*unused/.test(issue)));
});

test('rejects an undefined foreground variable', () => {
  const theme = loadTheme();
  theme.colors.text = 'unknownVariable';
  assert.ok(validateTheme(theme).some((issue) => /invalid: .*text/.test(issue)));
});

test('rejects a cycle between referenced variables', () => {
  const theme = loadTheme();
  theme.vars.comment = 'commentAlias';
  theme.vars.commentAlias = 'comment';
  assert.ok(validateTheme(theme).some((issue) => /cycle: .*comment/.test(issue)));
});

test('rejects a missing export info background without throwing', () => {
  const theme = loadTheme();
  delete theme.export.infoBg;
  assert.ok(validateTheme(theme).some((issue) => /missing: export.infoBg/.test(issue)));
});

test('accepts a theme without optional export settings', () => {
  const theme = loadTheme();
  delete theme.export;
  assert.deepEqual(validateTheme(theme), []);
});

test('rejects a missing required foreground token', () => {
  const theme = loadTheme();
  delete theme.colors.text;
  assert.ok(validateTheme(theme).some((issue) => /missing: text not defined/.test(issue)));
});

test('rejects insufficient text contrast', () => {
  const theme = loadTheme();
  theme.colors.text = theme.vars.background;
  assert.ok(validateTheme(theme).some((issue) => /contrast: text /.test(issue)));
});

test('rejects syntax colors that duplicate status colors', () => {
  const theme = loadTheme();
  theme.colors.syntaxString = theme.colors.success;
  assert.ok(validateTheme(theme).some((issue) => /semantic: success /.test(issue)));
});

test('rejects indistinguishable surfaces', () => {
  const theme = loadTheme();
  theme.vars.selection = theme.vars.background;
  assert.ok(validateTheme(theme).some((issue) => /separation: selection vs background/.test(issue)));
});

test('rejects low-contrast export metadata', () => {
  const theme = loadTheme('harpy-insone');
  theme.vars.dimText = '#737A88';
  const issues = validateTheme(theme);
  assert.ok(issues.some((issue) => /export: dim .*export.pageBg/.test(issue)));
  assert.ok(issues.some((issue) => /export: dim .*export.cardBg/.test(issue)));
});

test('rejects search highlights that resolve to the selection background', () => {
  const theme = loadTheme();
  theme.vars.searchAlias = 'selection';
  theme.colors.searchMatchBg = 'searchAlias';
  assert.ok(validateTheme(theme).some((issue) => /semantic: selectedBg .*searchMatchBg/.test(issue)));
});

test('rejects identical search and selection colors with different hex casing', () => {
  const theme = loadTheme();
  theme.colors.searchMatchBg = theme.vars.selection.toLowerCase();
  assert.ok(validateTheme(theme).some((issue) => /semantic: selectedBg .*searchMatchBg/.test(issue)));
});

test('rejects unreadable search highlight text', () => {
  const theme = loadTheme();
  theme.colors.searchMatchText = theme.colors.searchMatchBg;
  assert.ok(validateTheme(theme).some((issue) => /search: .*searchMatchText.*searchMatchBg/.test(issue)));
});

test('accepts Pi fallbacks when optional search colors are omitted', () => {
  const theme = loadTheme();
  delete theme.colors.searchMatchText;
  delete theme.colors.searchMatchBg;
  assert.deepEqual(validateTheme(theme), []);
});

test('rejects unreadable search colors resolved through Pi fallbacks', () => {
  const theme = loadTheme();
  delete theme.colors.searchMatchText;
  delete theme.colors.searchMatchBg;
  theme.colors.selectedBg = theme.colors.text;
  assert.ok(validateTheme(theme).some((issue) => /search: .*searchMatchText.*searchMatchBg/.test(issue)));
});

test('rejects insufficient export info contrast', () => {
  const theme = loadTheme();
  theme.export.infoBg = theme.colors.text;
  assert.ok(validateTheme(theme).some((issue) => /export: text on export.infoBg/.test(issue)));
});
