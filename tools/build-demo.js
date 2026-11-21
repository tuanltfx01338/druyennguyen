// Builds dist/demo.html: the real client + real server code running on in-browser GAS fakes, fictional data.
// Run: node tools/build-demo.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const SERVER_FILES = ['Lib', 'Repo', 'Main', 'Patients', 'Visits', 'Images', 'Import', 'Backup'];
const server = SERVER_FILES.map(f => read(`src/server/${f}.gs`)).join('\n');
const publicFns = [...server.matchAll(/^function ([A-Za-z]\w*)\s*\(/gm)].map(m => m[1]).filter(n => !n.endsWith('_'));
const GLOBALS = ['SpreadsheetApp', 'DriveApp', 'Drive', 'Utilities', 'MimeType', 'PropertiesService', 'LockService',
  'CacheService', 'ScriptApp', 'UrlFetchApp', 'HtmlService'];
const noClose = s => s.replace(/<\/script/gi, '<\\/script');

const gasMock = read('test/gas-mock.js');
const client = f => read(`src/client/${f}.html`);

const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sổ bệnh án Nha khoa — bản xem thử giao diện</title>
${client('Styles')}
<style>
  .demo-banner { background:#fff8e1; color:#7a5200; font-size:12px; padding:6px 12px; text-align:center; border-bottom:1px solid #f3dfa5; }
  .demo-banner button { font-size:12px; padding:2px 8px; margin-left:6px; }
</style>
</head>
<body>
<div class="demo-banner">BẢN XEM THỬ · dữ liệu giả, chỉ nằm trong trang (tải lại = về ban đầu)<button onclick="demoBack()">↩ Quay lại</button></div>
<header class="topbar"><a href="#" id="home-link">🦷 Sổ bệnh án Nha khoa</a></header>
<main id="app"></main>
<div id="toast" role="status"></div>
<script>
const createGas = (function () {
${noClose(gasMock)}
  return createGas;
})();
window.__SERVER = function (gas) {
  const { ${GLOBALS.filter(g => g !== 'HtmlService').join(', ')} } = gas;
  const console = gas.console;
${noClose(server)}
  return { ${publicFns.join(', ')}, readActive_, reserveIds_, appendRows_, createPatientFolder_, now_ };
};
</script>
<script>
${noClose(read('tools/demo-seed.js'))}
</script>
${client('App.js')}
${client('Upload.js')}
${client('Import.js')}
<script>start();</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/demo.html'), html);
console.log('dist/demo.html', Math.round(html.length / 1024) + ' KB', publicFns.length + ' server fns');
