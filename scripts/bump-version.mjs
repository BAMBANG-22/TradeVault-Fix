#!/usr/bin/env node
/**
 * Version & Change Code Bump Helper for Git Push / Release workflow.
 * Usage:
 *   node scripts/bump-version.mjs [patch|minor|major] [CODE_SUFFIX] ["Title"] ["Summary"]
 * Example:
 *   node scripts/bump-version.mjs patch RSK02 "Fix layout" "Improved mobile padding"
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');
const verPath = path.join(root, 'src', 'config', 'appVersion.ts');
const changelogPath = path.join(root, 'CHANGELOG.md');

const level = process.argv[2] || 'patch';
const customSuffix = process.argv[3];
const customTitle = process.argv[4] || 'Update aplikasi & sinkronisasi perubahan';
const customSummary = process.argv[5] || 'Pembaruan fitur dan perbaikan rutin.';

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentVer = String(pkg.version || '1.1.0');
const parts = currentVer.split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);

if (level === 'major') {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
} else if (level === 'minor') {
  parts[1] += 1;
  parts[2] = 0;
} else {
  parts[2] += 1;
}

const nextVersion = `${parts[0]}.${parts[1]}.${parts[2]}`;
const now = new Date();
const yy = String(now.getUTCFullYear()).slice(-2);
const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
const dd = String(now.getUTCDate()).padStart(2, '0');
const randSuffix = Math.random().toString(36).slice(2, 6).toUpperCase();
const changeCode = customSuffix
  ? `VLO-${yy}${mm}-${customSuffix.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  : `VLO-${yy}${mm}${dd}-${randSuffix}`;
const dateStr = now.toISOString().slice(0, 10);

pkg.version = nextVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

let verContent = fs.readFileSync(verPath, 'utf8');
verContent = verContent
  .replace(/export const APP_VERSION = '.*?';/, `export const APP_VERSION = '${nextVersion}';`)
  .replace(/export const APP_CHANGE_CODE = '.*?';/, `export const APP_CHANGE_CODE = '${changeCode}';`)
  .replace(/export const APP_RELEASE_DATE = '.*?';/, `export const APP_RELEASE_DATE = '${dateStr}';`);

const newEntry = `  {
    version: '${nextVersion}',
    changeCode: '${changeCode}',
    date: '${dateStr}',
    titleId: ${JSON.stringify(customTitle)},
    titleEn: ${JSON.stringify(customTitle)},
    summaryId: ${JSON.stringify(customSummary)},
    summaryEn: ${JSON.stringify(customSummary)},
  },`;

verContent = verContent.replace(
  'export const APP_VERSION_HISTORY: AppVersionEntry[] = [\n',
  `export const APP_VERSION_HISTORY: AppVersionEntry[] = [\n${newEntry}\n`
);
fs.writeFileSync(verPath, verContent, 'utf8');

const changelogLine = `\n## v${nextVersion} · #${changeCode} (${dateStr})\n- ${customTitle}: ${customSummary}\n`;
if (fs.existsSync(changelogPath)) {
  const existing = fs.readFileSync(changelogPath, 'utf8');
  const updated = existing.replace('# Changelog\n', `# Changelog\n${changelogLine}`);
  fs.writeFileSync(changelogPath, updated, 'utf8');
} else {
  fs.writeFileSync(changelogPath, `# Changelog\n${changelogLine}`, 'utf8');
}

console.log(`Bumped version: v${currentVer} -> v${nextVersion} (#${changeCode})`);
