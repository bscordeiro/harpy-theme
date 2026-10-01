#!/usr/bin/env node
// Contrast regression check for harpy themes.
// WCAG 2 relative luminance; every text-like fg token is validated against
// the palette of surface backgrounds it may sit on in the TUI.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME_FILES = ['themes/harpy-noct.json', 'themes/harpy-insone.json'];

const TEXT_MIN = 4.5; // WCAG normal text
const TERTIARY_MIN = 3.0; // dim/separators, large headings
const SEPARATION_MIN = 1.15; // surface distinguishability heuristic

const PROXY_BG = ['background', 'surface', 'surfaceAlt', 'selection', 'surfaceSuccess', 'surfaceError'];
const FLAT_BG = ['background', 'surface', 'surfaceAlt'];

const RULES = [
  {
    min: TEXT_MIN,
    bgs: PROXY_BG,
    tokens: [
      'text', 'thinkingText', 'muted', 'toolOutput', 'toolTitle',
      'mdCode', 'mdCodeBlock', 'mdQuote', 'mdLink', 'mdLinkUrl', 'mdListBullet',
      'mdQuoteBorder', 'mdCodeBlockBorder',
      'userMessageText', 'customMessageText',
      'toolDiffContext',
    ],
  },
  {
    min: TEXT_MIN,
    bgs: FLAT_BG,
    tokens: [
      'syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable',
      'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxOperator',
      'syntaxPunctuation',
      'success', 'error', 'warning', 'toolDiffAdded', 'toolDiffRemoved',
      'customMessageLabel',
    ],
  },
  { min: TERTIARY_MIN, bgs: FLAT_BG, tokens: ['dim', 'mdHr'] },
  { min: TERTIARY_MIN, bgs: PROXY_BG, tokens: ['mdHeading'] },
];

// Distinct semantic roles must not resolve to the same hex color.
const FORBIDDEN_EQUAL = [
  ['success', 'syntaxString'],
  ['warning', 'syntaxNumber'],
  ['error', 'thinkingHigh'],
  ['error', 'thinkingXhigh'],
  ['error', 'thinkingMax'],
  ['selectedBg', 'searchMatchBg'],
];

const SEPARATION_PAIRS = [
  ['selection', 'background'],
  ['surfaceSuccess', 'surface'],
  ['surfaceError', 'surface'],
  ['surfaceAlt', 'surface'],
];

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function validateTheme(theme) {
  const failures = [];
  const vars = theme.vars ?? {};
  const colors = theme.colors ?? {};

  const resolveValue = (value, label) => {
    const seen = new Set();
    while (!isHexColor(value)) {
      if (typeof value !== 'string' || !Object.hasOwn(vars, value)) return null;
      if (seen.has(value)) {
        report('cycle', `${label} references circular variable ${value}`);
        return null;
      }
      seen.add(value);
      value = vars[value];
    }
    return value;
  };
  const resolve = (token) => resolveValue(colors[token], token);

  const report = (kind, msg) => {
    failures.push(`FAIL ${theme.name} ${kind}: ${msg}`);
  };

  for (const bgName of PROXY_BG) {
    if (!isHexColor(vars[bgName])) {
      report('invalid', `${bgName} must be a six-digit hex color`);
    }
  }
  for (const [name, value] of Object.entries(vars)) {
    if (!resolveValue(value, name)) report('invalid', `${name} must resolve to a six-digit hex color`);
  }
  for (const token of Object.keys(colors)) {
    if (!resolve(token)) report('invalid', `${token} must resolve to a six-digit hex color`);
  }
  if (theme.export) {
    if (!Object.hasOwn(theme.export, 'infoBg')) report('missing', 'export.infoBg not defined');
    for (const [name, value] of Object.entries(theme.export)) {
      if (!isHexColor(value)) {
        report('invalid', `export.${name} must be a six-digit hex color`);
      }
    }
  }
  if (failures.length > 0) return failures;

  for (const rule of RULES) {
    for (const token of rule.tokens) {
      const fg = resolve(token);
      if (!fg) {
        report('missing', `${token} not defined`);
        continue;
      }
      for (const bgName of rule.bgs) {
        const bg = vars[bgName];
        const value = ratio(fg, bg);
        if (value < rule.min) {
          report('contrast', `${token} (${fg}) on ${bgName} (${bg}) = ${value.toFixed(2)} < ${rule.min}`);
        }
      }
    }
  }

  const searchText = resolve('searchMatchText') ?? resolve('text');
  const searchBg = resolve('searchMatchBg') ?? resolve('selectedBg');
  if (searchText && searchBg) {
    const value = ratio(searchText, searchBg);
    if (value < TEXT_MIN) {
      report('search', `searchMatchText (${searchText}) on searchMatchBg (${searchBg}) = ${value.toFixed(2)} < ${TEXT_MIN}`);
    }
  }

  for (const [a, b] of FORBIDDEN_EQUAL) {
    const aColor = resolve(a);
    const bColor = resolve(b);
    if (aColor && bColor && aColor.toLowerCase() === bColor.toLowerCase()) {
      report('semantic', `${a} (${aColor}) must not equal ${b}`);
    }
  }

  for (const [a, b] of SEPARATION_PAIRS) {
    const value = ratio(vars[a], vars[b]);
    if (value < SEPARATION_MIN) {
      report('separation', `${a} vs ${b} = ${value.toFixed(2)} < ${SEPARATION_MIN}`);
    }
  }

  if (theme.export) {
    const text = resolve('text');
    if (text) {
      const value = ratio(text, theme.export.infoBg);
      if (value < TEXT_MIN) {
        report('export', `text on export.infoBg (${theme.export.infoBg}) = ${value.toFixed(2)} < ${TEXT_MIN}`);
      }
    }
    const dim = resolve('dim');
    for (const bgName of ['pageBg', 'cardBg']) {
      const bg = theme.export[bgName];
      if (!dim || !bg) continue;
      const value = ratio(dim, bg);
      if (value < TEXT_MIN) {
        report('export', `dim (${dim}) on export.${bgName} (${bg}) = ${value.toFixed(2)} < ${TEXT_MIN}`);
      }
    }
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  for (const file of THEME_FILES) {
    const theme = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const issues = validateTheme(theme);
    issues.forEach((issue) => console.log(issue));
    failures += issues.length;
  }
  if (failures > 0) {
    console.log(`\n${failures} contrast issue(s)`);
    process.exit(1);
  }
  console.log('All contrast checks passed.');
}
