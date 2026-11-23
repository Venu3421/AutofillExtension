import fs from 'fs';
import path from 'path';

// Read root manifest.json
const manifestPath = path.resolve('manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// In dist build, popup is located at popup/index.html (not src/popup/index.html)
manifest.action.default_popup = 'popup/index.html';

// Ensure dist directory exists
const distDir = path.resolve('dist');
fs.mkdirSync(distDir, { recursive: true });

// Move dist/src/popup to dist/popup
const nestedPopup = path.resolve('dist/src/popup');
const targetPopup = path.resolve('dist/popup');

if (fs.existsSync(nestedPopup)) {
  fs.mkdirSync(targetPopup, { recursive: true });
  fs.cpSync(nestedPopup, targetPopup, { recursive: true });
  fs.rmSync(path.resolve('dist/src'), { recursive: true, force: true });
}

// Fix relative asset paths in dist/popup/index.html
const popupHtmlPath = path.resolve('dist/popup/index.html');
if (fs.existsSync(popupHtmlPath)) {
  let html = fs.readFileSync(popupHtmlPath, 'utf8');
  html = html.replace(/\.\.\/\.\.\/popup\//g, './');
  fs.writeFileSync(popupHtmlPath, html);
  console.log('Normalized asset paths in dist/popup/index.html');
}

fs.writeFileSync(path.resolve('dist/manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Copied manifest.json to dist/ with production paths.');
