/* Shared, dependency-free helpers. No conversation text is retained. */
(() => {
  const mimeExtensions = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/heic': 'heic', 'image/avif': 'avif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'audio/wav': 'wav', 'audio/flac': 'flac', 'application/pdf': 'pdf',
    'application/zip': 'zip', 'application/x-rar-compressed': 'rar',
    'application/vnd.rar': 'rar', 'application/x-7z-compressed': '7z',
    'application/x-tgsticker': 'tgs', 'text/plain': 'txt',
    'application/vnd.android.package-archive': 'apk',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
  };
  function extension(name, mime) {
    const match = String(name || '').trim().match(/\.([^./\\\s]{1,24})$/u);
    return match ? match[1].toLowerCase() : mimeExtensions[mime?.toLowerCase()] || '__none__';
  }
  function safeName(value) {
    let s = String(value || 'file').normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_')
      .replace(/^\.+|[. ]+$/g, '').trim();
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = '_' + s;
    if (s.length > 160) {
      const ext = s.match(/\.[^.]{1,24}$/)?.[0] || '';
      s = s.slice(0, 150 - ext.length) + ext;
    }
    return s || 'file';
  }
  function attachments(message) {
    const m = message?.media;
    if (!m || m.ttl_seconds || m.pFlags?.ttl_seconds) return [];
    const entries = [];
    if (m.document?._ === 'document') entries.push(['document', m.document]);
    if (m.photo?._ === 'photo') entries.push(['photo', m.photo]);
    return entries.map(([slot, media]) => {
      const mime = media.mime_type || (slot === 'photo' ? 'image/jpeg' : '');
      let name = media.file_name || media.attributes?.find(a => a._ === 'documentAttributeFilename')?.file_name;
      const ext = extension(name, mime);
      if (!name) name = `${slot}_${media.id}${ext === '__none__' ? '' : '.' + ext}`;
      const sizes = (media.sizes || []).filter(s => s._ !== 'photoStrippedSize' && s._ !== 'photoSizeEmpty');
      const largest = sizes.sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0))[0];
      return { key: `${message.mid}:${slot}:${media.id}`, mid: message.mid, slot,
        mediaId: String(media.id), name, ext, mime,
        size: Number(media.size || largest?.size || largest?.sizes?.at(-1) || 0),
        date: message.date || 0, status: 'pending' };
    });
  }
  function nextPage(page, previousOffset) {
    if (!Array.isArray(page.ids)) throw Error('پاسخ تاریخچه معتبر نیست.');
    const ids = page.ids.filter(id => Number.isSafeInteger(id) && id > 0);
    const next = ids.length ? Math.min(...ids) : previousOffset;
    if (!page.complete && (!ids.length || (previousOffset && next >= previousOffset))) {
      throw Error('تاریخچه جلو نمی‌رود؛ بررسی کامل نشده است. دوباره ادامه دهید.');
    }
    return { offset: next, complete: page.complete === true };
  }
  globalThis.EitaaCore = { extension, safeName, attachments, nextPage };
})();
