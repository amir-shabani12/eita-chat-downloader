const $ = id => document.getElementById(id);
const number = n => Number(n || 0).toLocaleString('fa-IR');
function bytes(n) {
  if (!n) return 'نامشخص';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ${units[i]}`;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let session, catalog = [], busy = false, stopped = false, activeDownload, prepareToken;
let visibleLimit = 150;
let selected = new Set();
let sourceTab = Number(new URL(location.href).searchParams.get('tab')) || null;
const statusNames = { pending: 'در انتظار', preparing: 'دریافت از ایتا', downloading: 'در حال ذخیره', complete: 'ذخیره شد', failed: 'ناموفق' };
async function rpc(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error || 'ارتباط با افزونه قطع شد.');
  return response.value;
}
const page = (command, args = {}) => rpc({ type: 'page', tabId: sourceTab, command,
  args: { identity: session?.identity, ...args } });
function errorText(error) {
  const raw = error?.message || String(error);
  const flood = raw.match(/FLOOD_WAIT_?(\d+)/i);
  if (flood) return `ایتا درخواست مکث داده است. ${number(flood[1])} ثانیه صبر کنید، سپس ادامه دهید.`;
  return raw;
}
function showError(error) { $('error').hidden = false; $('error').textContent = errorText(error); }
function clearError() { $('error').hidden = true; $('error').textContent = ''; }
function status(text) { $('status').textContent = text; }
function textNode(tag, content) { const node = document.createElement(tag); node.textContent = content; return node; }
async function refreshTabs() {
  const tabs = await rpc({ type: 'tabs' });
  $('tabs').replaceChildren();
  if (!tabs.length) {
    $('tabs').append(new Option('ابتدا web.eitaa.com را در کروم باز کنید', ''));
  } else {
    for (const tab of tabs) $('tabs').append(new Option(`${tab.title || 'ایتا وب'} — ${tab.id}`, tab.id));
    if (tabs.some(t => t.id === sourceTab)) $('tabs').value = String(sourceTab);
  }
  controls();
}
function controls() {
  $('connect').disabled = busy || !$('tabs').value;
  $('refresh').disabled = busy;
  $('tabs').disabled = busy;
  $('scan').disabled = busy || !session || session.complete;
  $('scan').textContent = session?.offset && !session.complete ? 'ادامه بررسی تاریخچه' : 'بررسی تمام تاریخچه';
  $('stop').disabled = !busy || stopped;
  $('reset').disabled = busy || !session;
  $('forget').disabled = busy || !session;
  $('all').disabled = busy || !catalog.length;
  $('none').disabled = busy || !catalog.length;
  $('download').disabled = busy || !session?.complete || !catalog.some(f => selected.has(f.ext) && f.status !== 'complete');
  $('retry').disabled = busy || !session?.complete || !catalog.some(f => selected.has(f.ext) && f.status === 'failed');
  $('export').disabled = busy || !session;
  for (const input of $('extensions').querySelectorAll('input')) input.disabled = busy;
}
function renderTable() {
  const query = $('search').value.trim().toLowerCase();
  const filtered = catalog.filter(f => !query || f.name.toLowerCase().includes(query) || f.ext.includes(query));
  const fragment = document.createDocumentFragment();
  for (const file of filtered.slice(0, visibleLimit)) {
    const row = document.createElement('tr');
    row.append(textNode('td', file.name), textNode('td', file.ext === '__none__' ? 'بدون پسوند' : '.' + file.ext),
      textNode('td', bytes(file.size)), textNode('td', statusNames[file.status] || file.status));
    if (file.error) row.lastChild.title = file.error;
    fragment.append(row);
  }
  $('files').replaceChildren(fragment);
  $('more').hidden = filtered.length <= visibleLimit;
}
function selectionText() {
  const files = catalog.filter(f => selected.has(f.ext));
  $('selection').textContent = `${number(files.length)} فایل انتخاب‌شده · ${bytes(files.reduce((n, f) => n + f.size, 0))}`;
}
function render() {
  const groups = new Map();
  for (const file of catalog) {
    const g = groups.get(file.ext) || { count: 0, size: 0 };
    g.count++; g.size += file.size; groups.set(file.ext, g);
  }
  const fragment = document.createDocumentFragment();
  for (const [ext, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    const label = document.createElement('label'); label.className = 'ext';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(ext);
    input.addEventListener('change', () => {
      if (input.checked) selected.add(ext); else selected.delete(ext);
      session.selected = [...selected];
      Store.saveSession(session).catch(showError);
      selectionText(); controls();
    });
    const detail = document.createElement('span');
    detail.append(textNode('b', ext === '__none__' ? 'بدون پسوند' : '.' + ext),
      textNode('small', `${number(g.count)} فایل · ${bytes(g.size)}`));
    label.append(input, detail); fragment.append(label);
  }
  if (!groups.size) fragment.append(textNode('div', 'هنوز فایلی شناسایی نشده است.'));
  $('extensions').replaceChildren(fragment);
  $('chat').textContent = session ? `${session.title} · شناسه ${session.peerId}` : 'هنوز گفتگویی انتخاب نشده است.';
  $('coverage').textContent = session?.complete
    ? `پایان تاریخچه تأیید شد. ${number(session.scanned)} پیام تا زمان شروع بررسی پوشش داده شد.`
    : 'بررسی هنوز کامل نشده است؛ دانلود پس از تأیید پایان تاریخچه فعال می‌شود.';
  $('stats').replaceChildren(...[
    `${number(session?.scanned)} پیام بررسی‌شده`, `${number(catalog.length)} فایل`,
    `${number(catalog.filter(f => f.status === 'complete').length)} ذخیره‌شده`,
    `${number(catalog.filter(f => f.status === 'failed').length)} ناموفق`
  ].map(s => textNode('span', s)));
  const progress = $('progress');
  if (session?.complete) { progress.max = 1; progress.value = 1; }
  else if (session?.total > 0) { progress.max = session.total; progress.value = Math.min(session.scanned, session.total); }
  else progress.removeAttribute('value');
  selectionText(); renderTable(); controls();
}
async function connect() {
  sourceTab = Number($('tabs').value);
  if (!sourceTab) throw Error('زبانه ایتا وب پیدا نشد.');
  // Context must not be checked against the previous selection here.
  const c = await rpc({ type: 'page', tabId: sourceTab, command: 'context' });
  session = await Store.session(c.identity) || { identity: c.identity, peerId: c.peerId, title: c.title,
    offset: 0, scanned: 0, total: 0, complete: false, selected: [], startedAt: null, scanId: crypto.randomUUID() };
  session.title = c.title; session.tabId = sourceTab;
  if (session.complete) await Store.prune(session);
  await Store.saveSession(session);
  selected = new Set(session.selected || []);
  catalog = await Store.files(session.identity);
  // Reconcile downloads left running when the dashboard closed.
  for (const file of catalog) {
    if (file.status === 'preparing') {
      if (file.prepareToken) await page('cancelPrepare', { token: file.prepareToken }).catch(() => {});
      delete file.prepareToken;
      file.status = 'pending'; await Store.saveFile(file);
    }
    if (file.status === 'downloading') {
      try {
        const result = await rpc({ type: 'downloadState', id: file.downloadId });
        file.status = result.state === 'complete' ? 'complete' : result.state === 'in_progress' ? 'downloading' : 'failed';
        if (file.status === 'failed') file.error = result.error || 'دانلود قطع شده است.';
      } catch (e) { file.status = 'failed'; file.error = errorText(e); }
      if (file.status !== 'downloading' && file.blobUrl) {
        await page('release', { url: file.blobUrl }).catch(() => {});
        delete file.blobUrl;
      }
      await Store.saveFile(file);
    }
  }
  status(session.complete ? 'فهرست کامل ذخیره‌شده آماده است. برای پیام‌های جدید «بررسی دوباره از ابتدا» را بزنید.' : 'گفتگو متصل شد. آماده بررسی تمام تاریخچه.');
  render();
}
async function scan() {
  if (!session.startedAt) session.startedAt = new Date().toISOString();
  while (!stopped && !session.complete) {
    status(`در حال خواندن تاریخچه… ${number(session.scanned)} پیام بررسی شده`);
    const result = await page('page', { offset: session.offset });
    if (stopped) break;
    const next = EitaaCore.nextPage(result, session.offset);
    const newIds = new Set(result.ids.filter(id => id > 0 && (!session.offset || id < session.offset)));
    const oldOffset = session.offset;
    const updated = { ...session, offset: next.offset, complete: next.complete,
      scanned: session.scanned + newIds.size, total: result.total || session.total,
      completedAt: next.complete ? new Date().toISOString() : null };
    // Cursor and catalog page commit together, so a restart cannot skip a page.
    await Store.page(updated, result.files.filter(f => !oldOffset || f.mid < oldOffset));
    session = updated;
    if (session.complete) await Store.prune(session);
    catalog = await Store.files(session.identity);
    render();
    if (!session.complete) await pause(450);
  }
  status(session.complete ? 'بررسی کامل شد؛ ایتا رسیدن به قدیمی‌ترین پیام را تأیید کرد. پسوندها را انتخاب کنید.' : 'بررسی متوقف شد؛ می‌توانید از همین نقطه ادامه دهید.');
}
async function waitForDownload(file) {
  activeDownload = file.downloadId;
  let cancelled = false;
  try {
    while (true) {
      if (stopped && !cancelled) {
        await rpc({ type: 'cancel', id: activeDownload }); cancelled = true;
      }
      const result = await rpc({ type: 'downloadState', id: activeDownload });
      $('current').textContent = `${file.name} · ${bytes(result.bytesReceived)} / ${bytes(result.totalBytes)}${result.paused ? ' · متوقف در کروم؛ از صفحه دانلودهای کروم ادامه دهید.' : ''}`;
      if (!['safe', 'accepted', 'allowlisted', 'deepScannedSafe'].includes(result.danger)) {
        $('current').textContent += ' · این فایل نیاز به بررسی در صفحه دانلودهای کروم دارد.';
      }
      if (result.state === 'complete') return;
      if (result.state === 'interrupted') throw Error(result.error || 'دانلود قطع شد.');
      await pause(800);
    }
  } finally { activeDownload = null; }
}
async function downloadFile(file) {
  let url = file.blobUrl;
  try {
    if (file.status !== 'downloading') {
      file.status = 'preparing'; delete file.error;
      await Store.saveFile(file); render();
      $('current').textContent = `دریافت از ایتا: ${file.name} (برای فایل بزرگ ممکن است زمان‌بر باشد)`;
      prepareToken = crypto.randomUUID();
      file.prepareToken = prepareToken;
      await Store.saveFile(file);
      await page('prepare', { item: { mid: file.mid, slot: file.slot, mediaId: file.mediaId }, token: prepareToken });
      let result;
      while (true) {
        if (stopped) {
          await page('cancelPrepare', { token: prepareToken });
          file.status = 'pending'; return;
        }
        result = await page('prepareState', { token: prepareToken });
        if (result.done) break;
        await pause(1000);
      }
      prepareToken = null; url = result.url;
      if (stopped) { file.status = 'pending'; await Store.saveFile(file); return; }
      file.size = result.size;
      const folder = file.ext === '__none__' ? 'no-extension' : EitaaCore.safeName(file.ext);
      const filename = `Eitaa/${EitaaCore.safeName(session.identity)}/${folder}/${file.mid}_${EitaaCore.safeName(file.name)}`;
      file.downloadId = await rpc({ type: 'save', tabId: sourceTab, url, filename });
      file.blobUrl = url; file.status = 'downloading';
      await Store.saveFile(file);
    }
    await waitForDownload(file);
    file.status = 'complete'; delete file.error;
  } catch (e) {
    file.status = stopped ? 'pending' : 'failed';
    file.error = errorText(e);
    if (!stopped) showError(`${file.name}: ${file.error}`);
    // Stop the batch on account/chat changes or service rate limits, keeping other files queued.
    if (/FLOOD|گفتگوی فعال|حساب|زبانه|وارد ایتا|ارتباط/.test(e?.message || String(e))) stopped = true;
  } finally {
    prepareToken = null;
    delete file.prepareToken;
    if (url) await page('release', { url }).catch(() => {});
    delete file.blobUrl;
    await Store.saveFile(file); render();
  }
}
async function download(retryOnly = false) {
  await page('context');
  const queue = catalog.filter(f => selected.has(f.ext) && (retryOnly ? f.status === 'failed' : f.status !== 'complete'));
  for (let index = 0; index < queue.length && !stopped; index++) {
    status(`دانلود ${number(index + 1)} از ${number(queue.length)}`);
    await downloadFile(queue[index]);
    if (!stopped) await pause(300);
  }
  $('current').textContent = '';
  status(stopped ? 'عملیات متوقف شد؛ فایل‌های ذخیره‌شده دوباره دانلود نمی‌شوند.'
    : catalog.some(f => selected.has(f.ext) && f.status === 'failed') ? 'صف دانلود تمام شد؛ بعضی فایل‌ها ناموفق بودند. امکان تلاش دوباره وجود دارد.' : 'تمام فایل‌های انتخاب‌شده ذخیره شدند.');
}
async function run(action) {
  if (busy) return;
  // A persistent dashboard and a Web Lock prevent two tabs from running the same job.
  await navigator.locks.request('eitaa-file-tool-operation', { ifAvailable: true }, async lock => {
    if (!lock) { showError(Error('عملیات در صفحه دیگری از افزونه در حال اجراست.')); return; }
    busy = true; stopped = false; clearError(); controls();
    try { await action(); }
    catch (error) { showError(error); status('عملیات کامل نشد؛ اطلاعات ثبت‌شده محفوظ است.'); }
    finally { busy = false; render(); }
  });
}
function bind(id, action) { $(id).addEventListener('click', () => run(action).catch(showError)); }
bind('refresh', refreshTabs);
bind('connect', connect);
bind('scan', scan);
bind('download', () => download(false));
bind('retry', () => download(true));
bind('reset', async () => {
  // Existing completed download statuses are preserved while re-indexing all pages.
  session = { ...session, offset: 0, scanned: 0, total: 0, complete: false, startedAt: null, completedAt: null, scanId: crypto.randomUUID() };
  await Store.saveSession(session);
  status('آماده بررسی دوباره از جدیدترین پیام؛ فایل‌های ذخیره‌شده دوباره دانلود نمی‌شوند.');
});
bind('forget', async () => {
  await Store.clear(session.identity); session = undefined; catalog = []; selected.clear();
  status('فهرست محلی پاک شد.');
});
for (const id of ['all', 'none']) $(id).addEventListener('click', async () => {
  selected = id === 'all' ? new Set(catalog.map(f => f.ext)) : new Set();
  session.selected = [...selected];
  await Store.saveSession(session).catch(showError); render();
});
$('stop').addEventListener('click', () => {
  stopped = true; controls(); status('در حال توقف…');
  if (prepareToken) page('cancelPrepare', { token: prepareToken }).catch(showError);
  if (activeDownload) rpc({ type: 'cancel', id: activeDownload }).catch(showError);
});
$('export').addEventListener('click', () => {
  const data = { conversation: { title: session.title, peerId: session.peerId },
    complete: session.complete, scanned: session.scanned, startedAt: session.startedAt,
    completedAt: session.completedAt, files: catalog.map(({ name, ext, size, status, mid, date, error }) => ({ name, ext, size, status, mid, date, error })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `eitaa-files-${session.peerId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('search').addEventListener('input', () => { visibleLimit = 150; renderTable(); });
$('more').addEventListener('click', () => { visibleLimit += 150; renderTable(); });
window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
(async () => { await refreshTabs(); render(); })().catch(showError);
