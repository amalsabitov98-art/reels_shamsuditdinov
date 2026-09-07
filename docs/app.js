const API = 'http://127.0.0.1:3210';
let selected = '';
let engineOnline = false;

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
    await request('/health');
    engineOnline = true;
    status.className = 'status online';
    status.innerHTML = '<span></span>Движок подключён';
    notice.classList.add('hidden');
    await refreshProjects();
  } catch {
    engineOnline = false;
    status.className = 'status offline';
    status.innerHTML = '<span></span>Движок не подключён';
    notice.classList.remove('hidden');
  }
  document.querySelectorAll('button, input, select').forEach(el => {
    if (el.id !== 'retryButton') el.disabled = !engineOnline;
  });
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
  const { project, spec } = await request(`/api/projects/${encodeURIComponent(slug)}`);
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
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function watchJob(job) {
  $('jobTitle').textContent = job.label;
  $('jobState').textContent = 'В РАБОТЕ';
  log.textContent = 'Задача запущена…';
  const timer = setInterval(async () => {
    try {
      const current = await request(`/api/jobs/${job.id}`);
      log.textContent = current.log || 'Задача выполняется…';
      log.scrollTop = log.scrollHeight;
      $('jobState').textContent = current.status === 'running' ? 'В РАБОТЕ' : current.status === 'done' ? 'ГОТОВО' : 'ОШИБКА';
      if (current.status !== 'running') {
        clearInterval(timer);
        await refreshProjects();
        if (current.status === 'done' && selected) await loadProject(selected).catch(() => {});
      }
    } catch (error) {
      clearInterval(timer);
      log.textContent += `\n${error.message}`;
    }
  }, 1800);
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
    if (action === 'storyboards') {
      if (!selected) throw new Error('Сначала выберите проект.');
      data = await request(`/api/projects/${encodeURIComponent(selected)}/storyboards`, {method:'POST'});
    }
    if (action === 'flow-run') {
      if (!selected) throw new Error('Сначала выберите проект.');
      data = await request(`/api/projects/${encodeURIComponent(selected)}/flow`, {method:'POST'});
    }
    if (action === 'verify') {
      if (!selected) throw new Error('Сначала выберите проект.');
      data = await request(`/api/projects/${encodeURIComponent(selected)}/verify`, {method:'POST'});
    }
    if (data?.job) watchJob(data.job);
  } catch (error) { log.textContent = error.message; }
}));

checkEngine();
setInterval(() => { if (!engineOnline) checkEngine(); }, 5000);
