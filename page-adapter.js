/* Runs in Eitaa's MAIN world only when the extension explicitly invokes it. */
(() => {
  if (window.__eitaaFileToolV1) return;
  const core = globalThis.EitaaCore;
  const urls = new Map();
  const downloads = new Map();
  function context(expected) {
    const root = window.rootScope;
    const chat = window.appImManager?.chat;
    const account = window.apiManagerProxy?.getTabState?.()?.accountNumber;
    if (!root?.myId || !root.managers || !chat?.peerId || !account) {
      throw Error('ابتدا وارد ایتا وب شوید و گفتگوی شخص موردنظر را باز کنید.');
    }
    const peerId = Number(chat.peerId);
    if (!Number.isSafeInteger(peerId) || peerId <= 0 || chat.threadId || chat.monoforumThreadId || (chat.type && chat.type !== 'chat')) {
      throw Error('یک گفتگوی عادی با یک شخص را باز کنید؛ این نسخه برای گروه، کانال و موضوع نیست.');
    }
    const identity = `${account}:${root.myId}:${peerId}`;
    if (expected && identity !== expected) throw Error('حساب یا گفتگوی فعال تغییر کرده است. به گفتگوی قبلی برگردید.');
    const peer = window.apiManagerProxy.getPeer?.(peerId);
    return { managers: root.managers, chat, peerId, identity,
      title: peer?.title || [peer?.first_name, peer?.last_name].filter(Boolean).join(' ') || `گفتگو ${peerId}` };
  }
  async function messageAt(c, mid, refresh = false) {
    let message = refresh ? undefined : window.apiManagerProxy.getMessageByPeer(c.peerId, mid);
    if (!message) message = await c.managers.appMessagesManager.getMessageByPeer(c.peerId, mid);
    if (!message || refresh) {
      await c.managers.appMessagesManager.reloadMessages(c.peerId, mid, true);
      message = await c.managers.appMessagesManager.getMessageByPeer(c.peerId, mid);
    }
    if (!message || message._ === 'messageEmpty') throw Error('پیام یا فایل دیگر در دسترس نیست.');
    return message;
  }
  window.__eitaaFileToolV1 = async (command, args = {}) => {
    try {
      if (command === 'release') {
        if (urls.has(args.url)) { URL.revokeObjectURL(args.url); urls.delete(args.url); }
        return { ok: true };
      }
      if (command === 'cancelPrepare') {
        const pending = downloads.get(args.token);
        if (pending) {
          pending.cancelled = true; pending.promise?.cancel?.();
          if (pending.result?.url) {
            URL.revokeObjectURL(pending.result.url); urls.delete(pending.result.url); downloads.delete(args.token);
          }
        }
        return { ok: true };
      }
      if (command === 'prepareState') {
        context(args.identity);
        const operation = downloads.get(args.token);
        if (!operation) throw Error('عملیات دریافت پیدا نشد؛ دوباره تلاش کنید.');
        if (operation.error) { downloads.delete(args.token); throw Error(operation.error); }
        if (operation.result) { downloads.delete(args.token); return { ok: true, done: true, ...operation.result }; }
        return { ok: true, done: false };
      }
      const c = context(args.identity);
      if (command === 'context') return { ok: true, identity: c.identity, peerId: c.peerId, title: c.title };
      if (command === 'page') {
        if (await c.managers.appPeersManager.isPeerRestricted(c.peerId)) throw Error('دسترسی به تاریخچه این گفتگو محدود است.');
        const result = await c.managers.appMessagesManager.getHistory({ peerId: c.peerId,
          offsetId: args.offset || 0, addOffset: 0, limit: 100, fetchIfWasNotFetched: true });
        context(c.identity);
        if (!Array.isArray(result.history)) throw Error('ساختار تاریخچه ایتا تغییر کرده است.');
        const messages = result.messages || await Promise.all(result.history.map(mid => messageAt(c, mid)));
        if (messages.length !== result.history.length || messages.some(m => !m || !Number.isSafeInteger(m.mid) || m.mid <= 0 ||
          (m.peerId && Number(m.peerId) !== c.peerId))) throw Error('بعضی پیام‌ها بارگذاری نشدند؛ بررسی را ادامه دهید.');
        return { ok: true, ids: messages.map(m => m.mid),
          complete: result.isEnd?.top === true, total: result.count,
          files: messages.flatMap(core.attachments) };
      }
      if (command === 'prepare') {
        const operation = { cancelled: false };
        downloads.set(args.token, operation);
        // Never hold an extension service-worker request open for a large file.
        (async () => {
        try {
          const message = await messageAt(c, args.item.mid, true);
          const media = message.media?.[args.item.slot];
          if (String(media?.id) !== args.item.mediaId) throw Error('پیوست این پیام تغییر کرده یا حذف شده است.');
          context(c.identity);
          if (operation.cancelled) throw Error('دانلود متوقف شد.');
          const options = { media };
          if (args.item.slot === 'photo') {
            options.thumb = [...(media.sizes || [])]
              .filter(s => s._ !== 'photoStrippedSize' && s._ !== 'photoSizeEmpty')
              .sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0))[0];
            if (!options.thumb) throw Error('نسخه اصلی تصویر در دسترس نیست.');
          }
          operation.promise = window.appDownloadManager.downloadMedia(options);
          const blob = await operation.promise;
          if (operation.cancelled) throw Error('دانلود متوقف شد.');
          if (!(blob instanceof Blob)) throw Error('ایتا فایل قابل ذخیره برنگرداند.');
          const url = URL.createObjectURL(blob);
          urls.set(url, Date.now());
          operation.result = { url, size: blob.size };
        } catch (error) {
          operation.error = error?.type || error?.message || String(error);
        } finally {
          // The URL owns the blob now. Release the app's per-download promise cache.
          const manager = window.appDownloadManager;
          for (const [key, entry] of Object.entries(manager?.downloads || {})) {
            if (entry.blob === operation.promise) manager.clearDownload(key, 'blob');
          }
          operation.finishedAt = Date.now();
        }
        })();
        return { ok: true, started: true };
      }
      throw Error('فرمان ناشناخته است.');
    } catch (error) { return { ok: false, error: error?.type || error?.message || String(error) }; }
  };
  // Recover blob URLs abandoned by a closed extension dashboard.
  setInterval(() => {
    for (const [url, created] of urls) if (Date.now() - created > 6 * 60 * 60 * 1000) {
      URL.revokeObjectURL(url); urls.delete(url);
    }
    for (const [token, op] of downloads) if (op.finishedAt && Date.now() - op.finishedAt > 6 * 60 * 60 * 1000) downloads.delete(token);
  }, 60000);
})();
