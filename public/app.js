/* ════════════════════════════════════════════════════════════════════════
   SlideMaker AI — app.js
   ════════════════════════════════════════════════════════════════════════ */

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  apiKey: '',
  model: 'openai/gpt-oss-120b:free',
  plan: null,            // { title, theme, colorScheme, slides[] }
  slides: {},            // { [id]: { ...planSlide, html, status } }
  slideOrder: [],        // [1,2,3,…]
  selectedSlide: null,
  generating: false,
  editPanelOpen: false,
  thumbBlobUrls: {},     // { [id]: blobUrl }  – for cleanup
  previewBlobUrl: null,
};

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const savedKey = localStorage.getItem('sm_key');
  const savedModel = localStorage.getItem('sm_model');

  if (savedKey) {
    document.getElementById('apiKey').value = savedKey;
    state.apiKey = savedKey;
  }
  if (savedModel) {
    const sel = document.getElementById('modelSelect');
    if ([...sel.options].some(o => o.value === savedModel)) sel.value = savedModel;
    state.model = savedModel;
  }

  document.getElementById('apiKey').addEventListener('input', e => {
    state.apiKey = e.target.value.trim();
    localStorage.setItem('sm_key', state.apiKey);
  });
  document.getElementById('modelSelect').addEventListener('change', e => {
    state.model = e.target.value;
    localStorage.setItem('sm_model', e.target.value);
  });

  window.addEventListener('resize', resizePreview);
});

// ── Helpers ────────────────────────────────────────────────────────────────
function toggleApiKeyVisibility() {
  const inp = document.getElementById('apiKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function $id(id) { return document.getElementById(id); }

// ── Chat helpers ───────────────────────────────────────────────────────────
function addMessage(role, html) {
  const wrap = $id('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;

  if (role === 'assistant') {
    div.innerHTML = `<div class="avatar">✦</div><div class="bubble">${html}</div>`;
  } else {
    div.innerHTML = `<div class="bubble">${escHtml(html)}</div>`;
  }

  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addThinking() {
  const div = addMessage('assistant', '<div class="thinking-dots"><span></span><span></span><span></span></div> Thinking…');
  div.dataset.thinking = '1';
  return div;
}

function removeThinking() {
  document.querySelectorAll('[data-thinking]').forEach(el => el.remove());
}

// ── Send message ───────────────────────────────────────────────────────────
async function sendMessage() {
  const inp = $id('chatInput');
  const text = inp.value.trim();
  if (!text || state.generating) return;

  if (!state.apiKey) {
    addMessage('assistant', '⚠️ Please enter your <strong>OpenRouter API key</strong> in the settings above.');
    return;
  }

  inp.value = '';
  addMessage('user', text);

  const thinking = addThinking();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, model: state.model, apiKey: state.apiKey, hasPlan: !!state.plan }),
    });
    const data = await res.json();
    thinking.remove();

    if (data.error) {
      addMessage('assistant', `❌ <strong>Error:</strong> ${escHtml(data.error)}`);
      return;
    }

    if (data.type === 'plan') {
      state.plan = data.plan;
      applyPlan(data.plan);
      addMessage('assistant',
        `✅ I've created a <strong>${data.plan.slides.length}-slide</strong> plan for <strong>"${escHtml(data.plan.title)}"</strong>.<br>
         <em>Theme:</em> ${escHtml(data.plan.theme)}<br><br>
         Review the plan in the canvas, then click <strong>Generate Slides</strong> to build them. Or tell me any changes!`
      );
    } else {
      // Conversational reply
      addMessage('assistant', data.message || 'How can I help you?');
    }
  } catch (err) {
    thinking.remove();
    addMessage('assistant', `❌ <strong>Network error:</strong> ${escHtml(err.message)}`);
  }
}

// ── Apply plan to canvas ───────────────────────────────────────────────────
function applyPlan(plan) {
  // Reset slide state
  state.slides = {};
  state.slideOrder = plan.slides.map(s => s.id);
  plan.slides.forEach(s => { state.slides[s.id] = { ...s, status: 'pending', html: null }; });

  // Revoke old thumb blobs
  Object.values(state.thumbBlobUrls).forEach(u => URL.revokeObjectURL(u));
  state.thumbBlobUrls = {};

  // Update UI
  $id('emptyState').style.display = 'none';
  $id('presentationTitle').textContent = plan.title;
  $id('slideCount').textContent = `${plan.slides.length} slides`;

  // Render design system card
  const ds = plan.designSystem || {};
  const dsCard = $id('designSystemCard');
  if (dsCard) {
    dsCard.innerHTML = `
      <div class="ds-card">
        <div class="ds-card-header">
          <span class="ds-label">🎨 Global Design System</span>
          <span class="ds-mood">${escHtml(ds.moodBoard || plan.theme || '')}</span>
        </div>
        <div class="ds-grid">
          ${ds.typography ? `<div class="ds-row"><span class="ds-key">Typography</span><span class="ds-val">${escHtml(ds.typography)}</span></div>` : ''}
          ${ds.spacing ? `<div class="ds-row"><span class="ds-key">Spacing</span><span class="ds-val">${escHtml(ds.spacing)}</span></div>` : ''}
          ${ds.animationStyle ? `<div class="ds-row"><span class="ds-key">Animation</span><span class="ds-val">${escHtml(ds.animationStyle)}</span></div>` : ''}
          ${ds.visualMotifs ? `<div class="ds-row"><span class="ds-key">Visual Motifs</span><span class="ds-val">${escHtml(ds.visualMotifs)}</span></div>` : ''}
          ${ds.componentPatterns ? `<div class="ds-row"><span class="ds-key">Components</span><span class="ds-val">${escHtml(ds.componentPatterns)}</span></div>` : ''}
          ${ds.layoutPrinciples ? `<div class="ds-row"><span class="ds-key">Layout Rules</span><span class="ds-val">${escHtml(ds.layoutPrinciples)}</span></div>` : ''}
          <div class="ds-row"><span class="ds-key">Color Scheme</span><span class="ds-val">${escHtml(plan.colorScheme || '')}</span></div>
        </div>
      </div>`;
  }

  // Render todo list with rich detail
  const list = $id('slideList');
  list.innerHTML = plan.slides.map(s => `
    <div class="slide-todo-item" id="todo-${s.id}" data-status="pending" data-id="${s.id}">
      <div class="todo-num">${s.id}</div>
      <div class="todo-body">
        <div class="todo-header-row">
          <div class="todo-title">${escHtml(s.title)}</div>
          <span class="todo-type-badge">${escHtml(s.type || '')}</span>
        </div>
        ${s.contentStrategy ? `<div class="todo-strategy">${escHtml(s.contentStrategy)}</div>` : ''}
        ${s.layout ? `<div class="todo-layout"><span class="todo-layout-icon">⊞</span>${escHtml(s.layout)}</div>` : ''}
        ${s.description ? `<div class="todo-desc">${escHtml(s.description)}</div>` : ''}
        ${s.keyPoints?.length ? `<ul class="todo-keypoints">${s.keyPoints.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul>` : ''}
        ${s.visualElements ? `<div class="todo-visuals"><span class="todo-visuals-icon">✦</span>${escHtml(s.visualElements)}</div>` : ''}
        <div class="progress-text" id="prog-${s.id}" style="display:none"></div>
      </div>
      <span class="todo-badge badge-pending" id="badge-${s.id}">Pending</span>
    </div>
  `).join('');

  $id('planSection').style.display = 'block';
  $id('gridSection').style.display = 'none';
  $id('slideGrid').innerHTML = '';
  $id('previewSection').style.display = 'none';
  $id('generateBtn').style.display = 'flex';
  $id('clearBtn').style.display = 'flex';
  $id('exportBtn').style.display = 'none';
}

// ── Generation ─────────────────────────────────────────────────────────────
async function startGeneration() {
  if (!state.plan || state.generating) return;

  state.generating = true;
  const genBtn = $id('generateBtn');
  genBtn.disabled = true;
  genBtn.innerHTML = '<span class="btn-icon">⏳</span> Generating…';

  $id('gridSection').style.display = 'block';

  const BATCH_SIZE = 15;
  let doneCount = 0;
  const total = state.slideOrder.length;
  const pending = state.slideOrder.filter(id => state.slides[id]?.status !== 'done');

  const onSlideDone = () => {
    doneCount++;
    $id('gridProgress').textContent = `${doneCount}/${total} done`;
  };

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(id => streamGenerateSlide(state.slides[id], onSlideDone)));
  }

  state.generating = false;
  genBtn.style.display = 'none';
  $id('exportBtn').style.display = 'flex';
  $id('gridProgress').textContent = `${total}/${total} done`;

  addMessage('assistant',
    `🎉 All <strong>${total} slides</strong> generated! Click any slide to preview or edit it. Use <strong>Export PPTX</strong> when ready.`
  );
}

async function streamGenerateSlide(slide, onDone) {
  setTodoStatus(slide.id, 'generating');
  ensureThumbPlaceholder(slide);

  const totalSlides = state.slideOrder.length;

  try {
    const res = await fetch('/api/generate-slide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: { ...slide, totalSlides },
        theme: state.plan.theme,
        colorScheme: state.plan.colorScheme,
        designSystem: state.plan.designSystem || null,
        model: state.model,
        apiKey: state.apiKey,
        presentationTitle: state.plan.title,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (!raw || raw === '[DONE]') continue;

        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'chunk') {
            const prog = $id(`prog-${slide.id}`);
            if (prog) { prog.style.display = 'block'; prog.textContent = `✍ Writing… ${evt.chars} chars`; }
          } else if (evt.type === 'done') {
            state.slides[slide.id].html = evt.html;
            state.slides[slide.id].status = 'done';
            setTodoStatus(slide.id, 'done');
            updateThumb(slide.id, evt.html);
            onDone();
            const prog = $id(`prog-${slide.id}`);
            if (prog) prog.style.display = 'none';
          } else if (evt.type === 'error') {
            state.slides[slide.id].status = 'error';
            setTodoStatus(slide.id, 'error');
          }
        } catch {}
      }
    }
  } catch (err) {
    state.slides[slide.id].status = 'error';
    setTodoStatus(slide.id, 'error');
  }
}

// ── Todo status helpers ────────────────────────────────────────────────────
function setTodoStatus(id, status) {
  const item = $id(`todo-${id}`);
  const badge = $id(`badge-${id}`);
  if (!item || !badge) return;

  item.dataset.status = status;
  const map = {
    pending:    ['badge-pending',    'Pending'],
    generating: ['badge-generating', 'Generating…'],
    done:       ['badge-done',       '✓ Done'],
    error:      ['badge-error',      '✕ Error'],
  };
  const [cls, text] = map[status] || map.pending;
  badge.className = `todo-badge ${cls}`;
  badge.textContent = text;
}

// ── Thumbnail management ───────────────────────────────────────────────────
function ensureThumbPlaceholder(slide) {
  const grid = $id('slideGrid');
  if ($id(`thumb-${slide.id}`)) return;

  const div = document.createElement('div');
  div.className = 'slide-thumb';
  div.id = `thumb-${slide.id}`;
  div.dataset.id = slide.id;
  div.onclick = () => selectSlide(slide.id);
  div.innerHTML = `
    <div class="thumb-frame-container">
      <div class="thumb-generating">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Generating…</span>
      </div>
    </div>
    <div class="thumb-footer">
      <div class="thumb-num">${slide.id}</div>
      <div class="thumb-label">${escHtml(slide.title)}</div>
    </div>`;

  // Insert in correct position
  const sorted = [...grid.children].sort((a, b) =>
    parseInt(a.dataset.id) - parseInt(b.dataset.id)
  );
  const after = sorted.find(el => parseInt(el.dataset.id) > slide.id);
  after ? grid.insertBefore(div, after) : grid.appendChild(div);
}

function updateThumb(id, html) {
  const thumb = $id(`thumb-${id}`);
  if (!thumb) return;

  // Revoke old blob
  if (state.thumbBlobUrls[id]) URL.revokeObjectURL(state.thumbBlobUrls[id]);
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  state.thumbBlobUrls[id] = blobUrl;

  const containerWidth = 220; // matches grid minmax
  const scale = containerWidth / 1280;
  const thumbH = Math.round(720 * scale);

  thumb.querySelector('.thumb-frame-container').innerHTML = `
    <iframe
      class="thumb-iframe"
      src="${blobUrl}"
      sandbox="allow-same-origin allow-scripts"
      scrolling="no"
      style="width:1280px;height:720px;border:none;transform:scale(${scale});transform-origin:top left;pointer-events:none;"
    ></iframe>`;
  thumb.querySelector('.thumb-frame-container').style.height = `${thumbH}px`;
}

// ── Slide preview ──────────────────────────────────────────────────────────
function selectSlide(id) {
  id = parseInt(id);
  state.selectedSlide = id;

  document.querySelectorAll('.slide-thumb').forEach(el =>
    el.classList.toggle('selected', parseInt(el.dataset.id) === id)
  );

  const slide = state.slides[id];
  if (!slide?.html) return;

  $id('previewSection').style.display = 'flex';
  $id('previewLabel').textContent = `Slide ${id}: ${slide.title}`;

  // Update preview iframe via blob URL
  if (state.previewBlobUrl) URL.revokeObjectURL(state.previewBlobUrl);
  state.previewBlobUrl = URL.createObjectURL(new Blob([slide.html], { type: 'text/html' }));
  $id('previewIframe').src = state.previewBlobUrl;

  resizePreview();

  // Scroll preview into view
  $id('previewSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resizePreview() {
  const wrap = $id('previewWrap');
  if (!wrap) return;
  const scale = wrap.clientWidth / 1280;
  const iframe = $id('previewIframe');
  iframe.style.transform = `scale(${scale})`;
  wrap.style.height = `${Math.round(720 * scale)}px`;
}

function navigateSlide(delta) {
  if (state.selectedSlide === null) return;
  const idx = state.slideOrder.indexOf(state.selectedSlide);
  const next = state.slideOrder[idx + delta];
  if (next !== undefined && state.slides[next]?.status === 'done') selectSlide(next);
}

// ── Edit panel ─────────────────────────────────────────────────────────────
function toggleEditPanel() {
  state.editPanelOpen = !state.editPanelOpen;
  $id('editPanel').style.display = state.editPanelOpen ? 'block' : 'none';
  $id('editToggleBtn').classList.toggle('active', state.editPanelOpen);
  if (state.editPanelOpen) $id('editInput').focus();
}

async function submitEdit() {
  const id = state.selectedSlide;
  if (!id) return;

  const instruction = $id('editInput').value.trim();
  if (!instruction) return;

  const currentHtml = state.slides[id]?.html;
  if (!currentHtml) return;

  const btn = $id('applyEditBtn');
  const statusEl = $id('editStatus');
  btn.disabled = true;
  btn.textContent = 'Applying…';
  statusEl.textContent = '';

  setTodoStatus(id, 'generating');

  try {
    const res = await fetch('/api/edit-slide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slideId: id,
        instruction,
        currentHtml,
        model: state.model,
        apiKey: state.apiKey,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chars = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (!raw || raw === '[DONE]') continue;

        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'chunk') {
            chars = evt.chars || chars;
            statusEl.textContent = `Writing… ${chars} chars`;
          } else if (evt.type === 'done') {
            state.slides[id].html = evt.html;
            state.slides[id].status = 'done';
            setTodoStatus(id, 'done');
            updateThumb(id, evt.html);
            selectSlide(id);
            statusEl.textContent = '✓ Applied';
            $id('editInput').value = '';
          } else if (evt.type === 'error') {
            setTodoStatus(id, 'done'); // revert visual
            statusEl.textContent = `❌ ${evt.message}`;
          }
        } catch {}
      }
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    setTodoStatus(id, 'done');
  }

  btn.disabled = false;
  btn.textContent = 'Apply Changes';
}

// ── Export to PPTX ─────────────────────────────────────────────────────────
async function exportToPPT() {
  const doneSlides = state.slideOrder.filter(id => state.slides[id]?.status === 'done');
  if (!doneSlides.length) {
    addMessage('assistant', '⚠️ No completed slides to export.');
    return;
  }

  addMessage('assistant', `📊 Exporting <strong>${doneSlides.length} slides</strong> to PPTX… This may take 10–30 seconds.`);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"

  for (const id of doneSlides) {
    const slide = state.slides[id];
    try {
      const imgData = await captureSlide(slide.html);
      const pSlide = pptx.addSlide();
      pSlide.addImage({ data: imgData, x: 0, y: 0, w: '100%', h: '100%' });
    } catch (err) {
      console.warn(`Slide ${id} capture failed:`, err);
      // Add a blank slide with title as fallback
      const pSlide = pptx.addSlide();
      pSlide.addText(slide.title, { x: 1, y: 2.5, w: 11.33, h: 1, fontSize: 32, align: 'center', bold: true });
    }
  }

  const fileName = (state.plan?.title || 'presentation').replace(/[^a-z0-9 _-]/gi, '_');
  await pptx.writeFile({ fileName: `${fileName}.pptx` });
  addMessage('assistant', `✅ <strong>${fileName}.pptx</strong> downloaded!`);
}

async function captureSlide(html) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin allow-scripts';
    iframe.style.cssText = [
      'position:fixed', 'left:-9999px', 'top:0',
      'width:1280px', 'height:720px', 'border:none',
      'visibility:hidden', 'z-index:-1',
    ].join(';');

    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
    };

    iframe.onload = async () => {
      // Give CSS animations / layout a moment to settle
      await new Promise(r => setTimeout(r, 800));
      try {
        const canvas = await html2canvas(iframe.contentDocument.documentElement, {
          width: 1280, height: 720,
          scale: 1,
          useCORS: true, allowTaint: true,
          windowWidth: 1280, windowHeight: 720,
          logging: false,
        });
        cleanup();
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        cleanup();
        reject(e);
      }
    };

    iframe.onerror = () => { cleanup(); reject(new Error('iframe load failed')); };
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

// ── Clear / reset ──────────────────────────────────────────────────────────
async function clearPresentation() {
  if (!confirm('Clear the current presentation and start fresh?')) return;

  // Revoke blobs
  Object.values(state.thumbBlobUrls).forEach(u => URL.revokeObjectURL(u));
  if (state.previewBlobUrl) URL.revokeObjectURL(state.previewBlobUrl);

  Object.assign(state, {
    plan: null, slides: {}, slideOrder: [],
    selectedSlide: null, generating: false,
    editPanelOpen: false, thumbBlobUrls: {}, previewBlobUrl: null,
  });

  await fetch('/api/slides', { method: 'DELETE' }).catch(() => {});

  $id('emptyState').style.display = 'flex';
  $id('planSection').style.display = 'none';
  $id('gridSection').style.display = 'none';
  $id('previewSection').style.display = 'none';
  $id('editPanel').style.display = 'none';
  $id('generateBtn').style.display = 'none';
  $id('exportBtn').style.display = 'none';
  $id('clearBtn').style.display = 'none';
  $id('presentationTitle').textContent = 'No presentation yet';
  $id('slideList').innerHTML = '';
  $id('slideGrid').innerHTML = '';

  addMessage('assistant', '🗑 Cleared! Describe a new presentation whenever you\'re ready.');
}
