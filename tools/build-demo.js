// Builds dist/demo.html: the real client + real server code running on in-browser GAS fakes, fictional data.
// Run: node tools/build-demo.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const SERVER_FILES = ['Lib', 'Repo', 'Main', 'Patients', 'Visits', 'Appointments', 'Images', 'Import', 'Backup'];
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
<meta name="theme-color" content="#0F1E3D">
<title>Sổ bệnh án Nha khoa — bản xem thử giao diện</title>
${client('Styles')}
<style>
  .demo-banner { background:#FFF3DC; color:#7A4600; font-size:12px; padding:6px 12px; text-align:center; border-bottom:1px solid #F4C46A; }
  .demo-banner button { font-size:12px; min-height:26px; padding:2px 8px; margin-left:6px; }
  @media (min-width: 960px) { .demo-banner { margin-left:228px; } }
</style>
</head>
<body>
<div class="demo-banner">BẢN XEM THỬ · dữ liệu giả, chỉ nằm trong trang (tải lại = về ban đầu)<button onclick="demoBack()">↩ Quay lại</button></div>
<nav class="nav" aria-label="Điều hướng">
  <a href="#" class="brand" data-path="" data-icon="tooth">Sổ bệnh án</a>
  <a href="#" data-path="" data-icon="today">Hôm nay</a>
  <a href="#" data-path="calendar" data-icon="calendar">Lịch hẹn</a>
  <a href="#" data-path="patients" data-icon="users">Bệnh nhân</a>
  <button type="button" id="nav-add" class="nav-add" data-icon="plus">Thêm</button>
</nav>
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
${client('Calendar.js')}
${client('Import.js')}
<script>start();</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/demo.html'), html);
console.log('dist/demo.html', Math.round(html.length / 1024) + ' KB', publicFns.length + ' server fns');
