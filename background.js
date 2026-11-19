importScripts('core.js');
chrome.action.onClicked.addListener(async tab => {
  const url = new URL(chrome.runtime.getURL('dashboard.html'));
  if (tab.url?.startsWith('https://web.eitaa.com/')) url.searchParams.set('tab', tab.id);
  const existing = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard.html') + '*' });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else await chrome.tabs.create({ url: url.href });
});
async function checkTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (new URL(tab.url).origin !== 'https://web.eitaa.com') throw Error('زبانه ایتا وب در دسترس نیست.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html'))) return;
  (async () => {
    if (message.type === 'tabs') {
      return (await chrome.tabs.query({ url: 'https://web.eitaa.com/*' })).map(t => ({ id: t.id, title: t.title }));
    }
    if (message.type === 'page') {
      await checkTab(message.tabId);
      await chrome.scripting.executeScript({ target: { tabId: message.tabId }, world: 'MAIN', files: ['core.js', 'page-adapter.js'] });
      const [response] = await chrome.scripting.executeScript({ target: { tabId: message.tabId }, world: 'MAIN',
        func: (command, args) => window.__eitaaFileToolV1(command, args), args: [message.command, message.args || {}] });
      if (!response?.result?.ok) throw Error(response?.result?.error || 'ارتباط با ایتا قطع شد.');
      return response.result;
    }
    if (message.type === 'save') {
      await checkTab(message.tabId);
      if (!message.url?.startsWith('blob:https://web.eitaa.com/')) throw Error('نشانی دانلود معتبر نیست.');
      return await chrome.downloads.download({ url: message.url, filename: message.filename.split('/').map(EitaaCore.safeName).join('/'),
        conflictAction: 'uniquify', saveAs: false });
    }
    if (message.type === 'downloadState') {
      const [item] = await chrome.downloads.search({ id: message.id });
      if (!item || item.byExtensionId !== chrome.runtime.id) throw Error('دانلود پیدا نشد.');
      return { state: item.state, error: item.error, bytesReceived: item.bytesReceived, totalBytes: item.totalBytes,
        danger: item.danger, paused: item.paused };
    }
    if (message.type === 'cancel') {
      const [item] = await chrome.downloads.search({ id: message.id });
      if (item?.byExtensionId === chrome.runtime.id && item.state === 'in_progress') await chrome.downloads.cancel(message.id);
      return true;
    }
    throw Error('فرمان نامعتبر است.');
  })().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
