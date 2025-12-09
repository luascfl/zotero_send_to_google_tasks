const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const OUT_DIR = path.resolve(__dirname, 'build');
const CONTENT_OUT_DIR = path.join(OUT_DIR, 'content');

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  }
  else {
    fs.copyFileSync(src, dest);
  }
}

async function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(CONTENT_OUT_DIR, { recursive: true });

  await esbuild.build({
    entryPoints: [
      path.join(__dirname, 'content', 'googleTasks.ts'),
      path.join(__dirname, 'content', 'options.ts'),
    ],
    bundle: true,
    format: 'iife',
    target: ['firefox60'],
    outdir: CONTENT_OUT_DIR,
  });

  const assets = [
    ['manifest.json', 'manifest.json'],
    ['chrome.manifest', 'chrome.manifest'],
    ['bootstrap.js', 'bootstrap.js'],
    ['locale', 'locale'],
    ['defaults', 'defaults'],
    ['skin', 'skin'],
    [path.join('content', 'options.xhtml'), path.join('content', 'options.xhtml')],
  ];

  for (const [srcRelative, destRelative] of assets) {
    const src = path.join(__dirname, srcRelative);
    const dest = path.join(OUT_DIR, destRelative);
    copyRecursive(src, dest);
  }
}

build().catch(error => {
  console.error(error);
  process.exit(1);
});
