const API = 'http://127.0.0.1:3210';
let selected = '';
let engineOnline = false;
let busy = false;
let watchedJob = '';
function syncControls() {
  document.querySelectorAll('button, input, select').forEach(el => {
    if (el.id !== 'retryButton') el.disabled = !engineOnline || busy;
  });
}

const $ = id => document.getElementById(id);
const status = $('engineStatus');
const notice = $('offlineNotice');
const projectSelect = $('projectSelect');
const log = $('jobLog');

async function request(path, options = {}) {
  const response = await fetch(API + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

async function checkEngine() {
  try {
    const health = await request('/health', { signal: AbortSignal.timeout(5000) });
    if (health.version !== '1.1.0') throw new Error('Обновите локальную папку и перезапустите START.bat: требуется движок 1.1.0.');
    engineOnline = true;
    status.className = 'status online';
    status.innerHTML = '<span></span>Движок подключён';
    notice.classList.add('hidden');
    await refreshProjects();
    if (health.job && !watchedJob) watchJob(health.job);
  } catch (error) {
    engineOnline = false;
    status.className = 'status offline';
    status.innerHTML = '<span></span>Движок не подключён';
    notice.classList.remove('hidden');
    log.textContent = error.message;
  }
  syncControls();
}

async function refreshProjects() {
  const projects = await request('/api/projects');
  const previous = selected || projectSelect.value;
  projectSelect.innerHTML = '<option value="">Выберите проект</option>' + projects.map(p => `<option value="${p.slug}">${p.slug}</option>`).join('');
  if (projects.some(p => p.slug === previous)) projectSelect.value = previous;
  else if (projects.length) projectSelect.value = projects.at(-1).slug;
  if (projectSelect.value && projectSelect.value !== selected) await loadProject(projectSelect.value);
}

async function loadProject(slug) {
  if (!slug) return;
  const { project, spec, approved = {} } = await request(`/api/projects/${encodeURIComponent(slug)}`);
  selected = slug;
  projectSelect.value = slug;
  $('projectEmpty').classList.add('hidden');
  $('projectInfo').classList.remove('hidden');
  $('durationStat').textContent = Math.round(project.duration);
  $('partsStat').textContent = project.parts.length;
  $('partList').innerHTML = project.parts.map(p => `<div class="part"><b>${p.n.toString().padStart(2, '0')}</b>${p.duration.toFixed(1)} c · ${escapeHtml(p.text || 'без текста')}</div>`).join('');
  $('specEditor').value = JSON.stringify(spec, null, 2);
  const finalUrl = `${API}/api/projects/${encodeURIComponent(slug)}/final`;
  $('downloadFinal').href = project.hasFinal ? finalUrl : '#';
  $('downloadFinal').classList.toggle('disabled', !project.hasFinal);
  $('reviewedParts').checked = false;
  $('approvedParts').innerHTML = project.parts.map(part => {
    const entry = approved[part.n];
    const url = `${API}/api/projects/${encodeURIComponent(slug)}/approved/${part.n}`;
    return `<div class="part"><b>Часть ${part.n} · ${part.duration.toFixed(1)} с</b><p>${escapeHtml(part.text || '')}</p>
      ${entry ? `<p>Выбрано: ${escapeHtml(entry.originalName)} · ${entry.duration.toFixed(2)} с</p><video controls preload="metadata" style="max-width:100%;max-height:300px" src="${url}?v=${entry.sha256}"></video>` : '<p>Видео результата ещё не выбрано.</p>'}
      <label>Выбрать результат этой части <input type="file" accept="video/mp4,video/quicktime,video/webm" data-part="${part.n}"></label></div>`;
  }).join('');
  syncControls();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function watchJob(job) {
  if (watchedJob === job.id) return;
  watchedJob = job.id;
  busy = true;
  syncControls();
  $('jobTitle').textContent = job.label;
  $('jobState').textContent = 'В РАБОТЕ';
  log.textContent = 'Задача запущена…';
  while (watchedJob === job.id) {
    try {
      const current = await request(`/api/jobs/${job.id}`);
      log.textContent = current.log || 'Задача выполняется…';
      log.scrollTop = log.scrollHeight;
      $('jobState').textContent = current.status === 'running' ? 'В РАБОТЕ' : current.status === 'done' ? 'ГОТОВО' : 'ОШИБКА';
      if (current.status !== 'running') {
        watchedJob = '';
        await refreshProjects();
        if (current.status === 'done' && selected) await loadProject(selected).catch(() => {});
      }
    } catch (error) {
      watchedJob = '';
      log.textContent += `\n${error.message}`;
    }
    if (watchedJob === job.id) await new Promise(resolve => setTimeout(resolve, 1800));
  }
  busy = false;
  syncControls();
}

$('videoInput').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  $('fileLabel').textContent = file.name;
  if (!$('slugInput').value) $('slugInput').value = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
});

const dropzone = $('dropzone');
['dragenter','dragover'].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => {
  $('videoInput').files = e.dataTransfer.files;
  $('videoInput').dispatchEvent(new Event('change'));
});

$('uploadForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const body = new FormData(event.target);
    body.set('prefix', 'r');
    const data = await request('/api/projects', { method: 'POST', body });
    selected = data.slug;
    watchJob(data.job);
  } catch (error) { log.textContent = error.message; }
});

projectSelect.addEventListener('change', () => loadProject(projectSelect.value).catch(e => log.textContent = e.message));
$('retryButton').addEventListener('click', checkEngine);

$('saveSpec').addEventListener('click', async () => {
  if (!selected) return;
  try {
    const spec = JSON.parse($('specEditor').value);
    await request(`/api/projects/${encodeURIComponent(selected)}/spec`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(spec) });
    log.textContent = 'Раскадровка сохранена.';
  } catch (error) { log.textContent = `Не сохранено: ${error.message}`; }
});

document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  const action = button.dataset.action;
  try {
    let data;
    if (action === 'chatgpt') data = await request('/api/actions/chatgpt', {method:'POST'});
    if (action === 'flow-open') data = await request('/api/actions/flow', {method:'POST'});
    if (action === 'flow-diagnose') data = await request('/api/actions/flow-diagnose', {method:'POST'});
    if (action === 'storyboards') {
      if (!selected) throw new Error('Сначала выберите проект.');
      data = await request(`/api/projects/${encodeURIComponent(selected)}/storyboards`, {method:'POST'});
    }
    if (action === 'flow-run') {
      if (!selected) throw new Error('Сначала выберите проект.');
      if (!confirm('Экспериментальный режим может расходовать кредиты Flow. Продолжить? Готовые результаты выбираются вручную ниже.')) return;
      data = await request(`/api/projects/${encodeURIComponent(selected)}/flow`, {method:'POST'});
    }
    if (action === 'verify') {
      if (!selected) throw new Error('Сначала выберите проект.');
      data = await request(`/api/projects/${encodeURIComponent(selected)}/verify`, {method:'POST'});
    }
    if (data?.job) watchJob(data.job);
  } catch (error) { log.textContent = error.message; }
}));

$('downloadDiagnostic').href = API + '/api/flow-diagnostic';
$('approvedParts').addEventListener('change', async event => {
  const input = event.target;
  if (!input.dataset.part || !input.files?.[0] || !selected) return;
  busy = true; syncControls();
  try {
    const body = new FormData(); body.append('video', input.files[0]);
    await request(`/api/projects/${encodeURIComponent(selected)}/approved/${input.dataset.part}`, { method: 'POST', body });
    await loadProject(selected);
    log.textContent = 'Часть сохранена. Посмотрите предпросмотр и проверьте речь.';
  } catch (e) { log.textContent = e.message; }
  finally { busy = false; syncControls(); }
});
$('assembleApproved').addEventListener('click', async () => {
  try {
    if (!selected || !$('reviewedParts').checked) throw new Error('Выберите проект, просмотрите части и отметьте подтверждение.');
    const data = await request(`/api/projects/${encodeURIComponent(selected)}/assemble-approved`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true }),
    });
    watchJob(data.job);
  } catch (e) { log.textContent = e.message; }
});

checkEngine();
setInterval(() => { if (!engineOnline) checkEngine(); }, 5000);
