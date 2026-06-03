/**
 * Tăng patch (1.0.0 → 1.0.1) trước mỗi lần build.
 * Nguồn: package.json → src/manifest.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function bumpPatch(version) {
  const parts = String(version).trim().split('.');
  const major = Math.max(0, parseInt(parts[0], 10) || 0);
  const minor = Math.max(0, parseInt(parts[1], 10) || 0);
  const patch = Math.max(0, parseInt(parts[2], 10) || 0) + 1;
  return `${major}.${minor}.${patch}`;
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const next = bumpPatch(pkg.version);
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const manifestTsPath = join(root, 'src', 'manifest.ts');
const manifestTs = readFileSync(manifestTsPath, 'utf8');
const updated = manifestTs.replace(
  /version:\s*'[\d.]+'/,
  `version: '${next}'`,
);
if (updated === manifestTs) {
  console.error('bump-version: không tìm thấy version trong src/manifest.ts');
  process.exit(1);
}
writeFileSync(manifestTsPath, updated, 'utf8');

console.log(`version ${next}`);
