const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const DIST_DIR = path.join(ROOT, 'dist');
const manifestPath = path.join(ROOT, 'manifest.json');

if (!fs.existsSync(BUILD_DIR)) {
  throw new Error('Build directory not found. Run `npm run build` first.');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version || '0.0.0';
const outputName = `zotero_send_to_google_tasks-${version}.xpi`;

fs.mkdirSync(DIST_DIR, { recursive: true });

const outPath = path.join(DIST_DIR, outputName);
const output = fs.createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('warning', err => {
  if (err.code === 'ENOENT') {
    console.warn(err);
  }
  else {
    throw err;
  }
});

archive.on('error', err => {
  throw err;
});

archive.pipe(output);

archive.directory(BUILD_DIR, false);

archive.finalize().then(() => {
  console.log(`Created ${outPath}`);
});
