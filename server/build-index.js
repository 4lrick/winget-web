import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const REPO_URL = 'https://github.com/microsoft/winget-pkgs.git';
const DATA_DIR = path.resolve('data');
const REPO_DIR = path.join(DATA_DIR, 'winget-pkgs');
const MANIFESTS_DIR = path.join(REPO_DIR, 'manifests');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureRepo(opts = { verbose: true, offline: false }) {
  ensureDataDirs();
  if (!fs.existsSync(REPO_DIR)) {
    if (opts.verbose) console.log('Cloning winget-pkgs (shallow)…');
    if (opts.offline) {
      throw new Error('Offline mode: repository does not exist locally. Place a clone at ' + REPO_DIR);
    }
    execSync(`git clone --depth 1 ${REPO_URL} ${REPO_DIR}`, { stdio: 'inherit' });
  } else {
    if (opts.offline) {
      if (opts.verbose) console.log('Offline mode: skipping git update for winget-pkgs');
      return;
    }
    if (opts.verbose) console.log('Updating winget-pkgs…');
    try {
      execSync(`git -C ${REPO_DIR} pull --ff-only`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('git pull failed, attempting hard reset to origin');
      try {
        execSync(`git -C ${REPO_DIR} fetch --depth 1 --all`, { stdio: 'inherit' });
        // try main then master
        try { execSync(`git -C ${REPO_DIR} reset --hard origin/main`, { stdio: 'inherit' }); }
        catch { execSync(`git -C ${REPO_DIR} reset --hard origin/master`, { stdio: 'inherit' }); }
      } catch (e2) {
        console.error('Failed to refresh repo:', e2.message);
        throw e2;
      }
    }
  }
}

function buildIndex(opts = { limit: Infinity, verbose: true }) {
  if (!fs.existsSync(MANIFESTS_DIR)) {
    throw new Error('Manifests directory not found. Did the clone succeed?');
  }
  const t0 = Date.now();
  const items = [];
  const seen = new Set();
  let count = 0;

  walk(MANIFESTS_DIR, (file) => {
    const base = path.basename(file).toLowerCase();
    const isYaml = base.endsWith('.yaml');
    const isDefaultLocale = /defaultlocale/.test(base);
    const isLocale = /\.locale\.[a-z0-9-]+\.yaml$/.test(base);
    if (!isYaml || (!isDefaultLocale && !isLocale)) return;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const pkg = parseDefaultLocaleYaml(raw);
      if (!pkg.PackageIdentifier) return;
      if (seen.has(pkg.PackageIdentifier)) return; // keep first occurrence
      seen.add(pkg.PackageIdentifier);
      items.push({
        PackageIdentifier: pkg.PackageIdentifier,
        Name: pkg.PackageName || pkg.Name || '',
        Publisher: pkg.Publisher || '',
        Moniker: pkg.Moniker || '',
        Version: pkg.PackageVersion || '',
        Description: pkg.ShortDescription || pkg.Description || '',
        Tags: pkg.Tags || [],
      });
      count++;
      if (opts.verbose && count % 2000 === 0) {
        process.stdout.write(`Indexed ${count}\r`);
      }
      if (count >= opts.limit) throw new StopWalk();
    } catch (e) {
      if (e instanceof StopWalk) throw e; // bubble up to break
      // Skip malformed files
    }
  });

  items.sort((a, b) => a.PackageIdentifier.localeCompare(b.PackageIdentifier));
  const out = { generatedAt: new Date().toISOString(), total: items.length, items };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(out));
  if (opts.verbose) console.log(`\nIndex built: ${items.length} packages in ${Math.round((Date.now() - t0) / 1000)}s`);
  return out;
}

function walk(dir, onFile) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) onFile(p);
    }
  }
}

class StopWalk extends Error {}

function unquote(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) return s.slice(1, -1);
  return s;
}

function parseDefaultLocaleYaml(text) {
  const lines = text.split(/\r?\n/);
  const out = {};

  const getScalar = (key) => {
    const re = new RegExp(`^${key}:(.*)$`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) return unquote(m[1]).trim();
    }
    return '';
  };

  const parseTags = () => {
    // Find start
    let i = lines.findIndex((l) => /^Tags\s*:/i.test(l));
    if (i === -1) return [];
    const line = lines[i];
    const after = line.split(':')[1] || '';
    // Inline array
    if (after.includes('[')) {
      const inside = after.substring(after.indexOf('[') + 1, after.indexOf(']'));
      return inside
        .split(',')
        .map((s) => unquote(s).trim())
        .filter(Boolean);
    }
    // Block list
    const tags = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*-\s*/.test(l)) {
        const val = l.replace(/^\s*-\s*/, '');
        tags.push(unquote(val).trim());
      } else if (/^\s*$/.test(l)) {
        continue;
      } else {
        break;
      }
    }
    return tags.filter(Boolean);
  };

  out.PackageIdentifier = getScalar('PackageIdentifier');
  out.PackageName = getScalar('PackageName') || getScalar('Name');
  out.Publisher = getScalar('Publisher');
  out.Moniker = getScalar('Moniker');
  out.ShortDescription = getScalar('ShortDescription');
  out.Description = getScalar('Description');
  out.PackageVersion = getScalar('PackageVersion');
  out.Tags = parseTags();
  return out;
}

const offline = process.env.OFFLINE === '1';
ensureRepo({ verbose: true, offline });
buildIndex({ verbose: true });
