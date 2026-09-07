// Pure predicates are tested separately from Flow's undocumented UI.
export function projectURL(value) {
  try {
    const u = new URL(value);
    const match = u.hostname === 'flow.google.com' ? u.pathname.match(/^\/project\/([^/]+)\/?$/)
      : u.hostname === 'labs.google' ? u.pathname.match(/^\/fx\/tools\/flow\/project\/([^/]+)\/?$/) : null;
    return u.protocol === 'https:' && match ? `${u.origin}${u.pathname.replace(/\/$/, '')}` : null;
  } catch { return null; }
}
export function selectProject(pages, requested = process.env.FLOW_PROJECT_URL) {
  const matches = pages.filter(p => projectURL(p.url()) && (!requested || projectURL(p.url()) === projectURL(requested)));
  if (matches.length !== 1) throw new Error(matches.length ? 'Открыто несколько проектов Flow. Оставьте один в специальном Chrome.' : 'Не найден единственный проект Flow. Откройте Flow через студию и войдите в проект.');
  return matches[0];
}
export function acceptsFile(accept, file) {
  const ext = file.toLowerCase().match(/\.[^.]+$/)?.[0];
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' })[ext];
  return !accept.trim() || accept.toLowerCase().split(',').some(x => {
    const t = x.trim();
    return t === '*/*' || t === ext || t === mime || (mime && t === `${mime.split('/')[0]}/*`);
  });
}
export function readyAsset(row, name) {
  if (/загрузка|обработка|uploading|processing|failed|ошибка/i.test(row)) return false;
  const type = row.match(/(Изображение|Видео|Image|Video)$/i)?.[0];
  if (!type) return false;
  if (/\.(png|jpe?g)$/i.test(name) && !/Изображение|Image/i.test(type)) return false;
  if (/\.(mp4|mov|webm)$/i.test(name) && !/Видео|Video/i.test(type)) return false;
  const actual = row.slice(0, -type.length).trim().replace(/\.(png|jpe?g|mp4|mov|webm)$/i, '');
  const wanted = name.replace(/\.(png|jpe?g|mp4|mov|webm)$/i, '');
  return actual.toLowerCase() === wanted.toLowerCase();
}
export async function readAssetRows(page) {
  return page.evaluate(() => [...new Set([...document.querySelectorAll('div,li,[role=option]')]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; })
    .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(t => t.length < 240 && /(Изображение|Видео|Image|Video)$/i.test(t)))]);
}
