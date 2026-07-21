const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORE = 'brutusmaq_orcamento_profissional_v2';
let state = { items: [], images: {} };

const fieldIds = [
  'quoteNumber', 'quoteDate', 'validity', 'responsible', 'clientName', 'clientDoc',
  'clientPhone', 'clientEmail', 'machineName', 'application', 'solution',
  'scopeSummary', 'model', 'power', 'workArea', 'production', 'voltage',
  'material', 'discount', 'freightValue', 'delivery', 'payment',
  'freightCondition', 'installation', 'warranty', 'support', 'notes'
];

const money = value => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[char]));

function val(id) {
  return $(`#${id}`)?.value || '';
}

function toast(text) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = text;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2200);
}

function uid() {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeComparable(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isGenericQuoteText(value, clientName = '') {
  const text = normalizeComparable(value);
  const client = normalizeComparable(clientName);
  if (!text) return true;
  if (/^orcamento(?:\s*[-–—:]|\s+para\b|\s+do\b|\s+da\b)/.test(text)) return true;
  if (client && text === client) return true;
  if (client && text.includes(client) && /orcamento/.test(text)) return true;
  return false;
}

function equipmentNameFromApplication(application) {
  const text = cleanText(application);
  if (!text) return '';

  const quoteMatch = text.match(/(?:formalizar\s+)?or[çc]amento\s+(.+?)(?=\s+com\b|\s+para\b|\s+incluindo\b|[.;,]|$)/i);
  if (quoteMatch?.[1]) return cleanText(quoteMatch[1]);

  const modelMatch = text.match(/\b(?:TR|TM|BM|MTR|PIC|MD|MP|MR|MX)[-\s]?[A-Z0-9]{2,}(?:[-/][A-Z0-9]+)*\b/i);
  return modelMatch?.[0] ? cleanText(modelMatch[0]) : '';
}

function preferredEquipmentName(data = {}) {
  const fields = data.fields || {};
  const clientName = fields.clientName || '';
  const machineName = cleanText(fields.machineName);

  if (machineName && !isGenericQuoteText(machineName, clientName)) return machineName;

  const fromApplication = equipmentNameFromApplication(fields.application);
  if (fromApplication) return fromApplication;

  const fromModel = cleanText(fields.model);
  if (fromModel) return fromModel;

  return machineName || 'EQUIPAMENTO INDUSTRIAL';
}

function normalizeItem(item = {}, index = 0, fallbackDescription = '') {
  const description = cleanText(item.description);
  return {
    id: cleanText(item.id) || uid(),
    code: cleanText(item.code) || String(index + 1).padStart(2, '0'),
    description: description || fallbackDescription || 'Equipamento principal',
    qty: Number(item.qty ?? 1),
    unit: Number(item.unit ?? 0)
  };
}

function normalizeImportedItems(items, data = {}) {
  const preferredName = preferredEquipmentName(data);
  const clientName = data.fields?.clientName || '';
  const importedTotal = Number(data.fields?.finalValue || data.fields?.total || 0);
  const normalizedItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const normalized = normalizeItem(item, index, preferredName);
    if (isGenericQuoteText(normalized.description, clientName)) {
      normalized.description = preferredName;
    }
    return normalized;
  });

  // Segurança para integrações antigas do CRM: se o valor final chegou no
  // cabeçalho, mas o item veio zerado, distribui o total no primeiro item.
  if (importedTotal > 0 && normalizedItems.length && !normalizedItems.some(item => Number(item.unit || 0) > 0)) {
    const first = normalizedItems[0];
    first.unit = importedTotal / Math.max(1, Number(first.qty || 1));
  }

  return normalizedItems;
}

function addItem(data = {}) {
  const fallback = cleanText(val('machineName')) || 'Equipamento principal';
  state.items.push(normalizeItem(data, state.items.length, fallback));
  renderItems();
  renderPreview();
  autosave();
}

function removeItem(id) {
  state.items = state.items.filter(item => item.id !== id);
  renderItems();
  renderPreview();
  autosave();
}

function renderItems() {
  const root = $('#itemEditor');
  if (!root) return;

  root.innerHTML = state.items.map((item, index) => `
    <div class="item-card" data-id="${esc(item.id)}">
      <div class="item-card-head">
        <strong>Item ${index + 1}</strong>
        <button class="remove-item" data-remove="${esc(item.id)}">Remover</button>
      </div>
      <div class="item-grid">
        <label>Código<input data-k="code" value="${esc(item.code)}"></label>
        <label>Descrição<input data-k="description" value="${esc(item.description)}" placeholder="Descrição do equipamento ou acessório"></label>
        <label>Qtd.<input data-k="qty" type="number" min="0" step="1" value="${item.qty}"></label>
        <label>Valor unitário<input data-k="unit" type="number" min="0" step="0.01" value="${item.unit}"></label>
      </div>
    </div>
  `).join('');
}

function bindItemEditorEvents() {
  const root = $('#itemEditor');
  if (!root) return;

  root.addEventListener('click', event => {
    const removeButton = event.target.closest('[data-remove]');
    if (!removeButton) return;
    removeItem(removeButton.dataset.remove);
  });

  root.addEventListener('input', event => {
    const input = event.target.closest('[data-k]');
    if (!input) return;

    const card = input.closest('.item-card');
    const item = state.items.find(row => row.id === card?.dataset.id);
    if (!item) return;

    item[input.dataset.k] = ['qty', 'unit'].includes(input.dataset.k)
      ? Number(input.value || 0)
      : input.value;

    renderPreview();
    autosave();
  });
}

function totalData() {
  const subtotal = state.items.reduce((sum, item) => {
    return sum + (Number(item.qty) || 0) * (Number(item.unit) || 0);
  }, 0);
  const discount = Number(val('discount') || 0);
  const freight = Number(val('freightValue') || 0);
  const total = Math.max(0, subtotal - discount + freight);
  return { subtotal, discount, freight, total };
}

function imageHTML(id, className = '') {
  const source = state.images[id];
  return `<div class="image-frame ${className} ${source ? '' : 'empty'}">${source ? `<img src="${source}" alt="Foto do equipamento">` : ''}</div>`;
}

function mmToPx(value) {
  const ruler = document.createElement('div');
  ruler.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${value}mm;height:1px;visibility:hidden;`;
  document.body.appendChild(ruler);
  const pixels = ruler.getBoundingClientRect().width;
  ruler.remove();
  return pixels || value * 3.7795275591;
}

function splitTextToFit(value, boxes) {
  const source = String(value || '').trim();
  if (!source) return [''];

  const tokens = source.match(/\S+\s*/g) || [source];
  const chunks = [];
  let cursor = 0;
  let boxIndex = 0;

  const measure = document.createElement('div');
  measure.className = 'doc-text pdf-text-measure';
  measure.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;white-space:pre-line;overflow-wrap:anywhere;';
  document.body.appendChild(measure);

  while (cursor < tokens.length) {
    const box = boxes[Math.min(boxIndex, boxes.length - 1)];
    measure.style.width = `${mmToPx(box.widthMm)}px`;
    measure.style.fontSize = `${box.fontPx || 10}px`;
    measure.style.lineHeight = String(box.lineHeight || 1.55);
    const maxHeight = mmToPx(box.heightMm);

    let low = cursor + 1;
    let high = tokens.length;
    let best = cursor + 1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      measure.textContent = tokens.slice(cursor, middle).join('');
      if (measure.scrollHeight <= maxHeight + 1) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    if (best <= cursor) best = cursor + 1;
    chunks.push(tokens.slice(cursor, best).join('').trim());
    cursor = best;
    boxIndex += 1;
  }

  measure.remove();
  return chunks;
}

function header(title, subtitle) {
  return `<header class="doc-header"><div class="doc-brand"><img src="assets/logo-b.png" alt="B"><div><div class="doc-brand-name">BRUTUSMAQ</div><div class="doc-brand-tag">FORÇA QUE TRANSFORMA</div></div></div><div class="doc-title"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div></header>`;
}

function footer(pageNumber, totalPages) {
  return `<footer class="doc-footer"><strong>BRUTUSMAQ INDÚSTRIA E COMÉRCIO DE MÁQUINAS LTDA.</strong><span>CNPJ 36.094.320/0001-03 | Contenda/PR</span><span>Página ${pageNumber} de ${totalPages}</span></footer>`;
}

function solutionContinuationPage(text, pageNumber, totalPages, totals, continuationIndex) {
  return `
    <section class="doc-page page-solution-continuation">
      ${header('CONTINUAÇÃO DA SOLUÇÃO PROPOSTA', `Detalhamento técnico • Parte ${continuationIndex}`)}
      <div class="doc-body">
        <div class="continuation-identification">
          <div><span>EQUIPAMENTO</span><strong>${esc(val('machineName') || 'EQUIPAMENTO INDUSTRIAL')}</strong></div>
          <div><span>CLIENTE</span><strong>${esc(val('clientName') || 'Não informado')}</strong></div>
          <div><span>ORÇAMENTO</span><strong>${esc(val('quoteNumber'))}</strong></div>
        </div>
        <div class="doc-section continuation-solution">
          <h2>SOLUÇÃO PROPOSTA — CONTINUAÇÃO</h2>
          <div class="doc-text">${esc(text)}</div>
        </div>
        <div class="continuation-total">
          <span>INVESTIMENTO TOTAL DA PROPOSTA</span>
          <strong>${money(totals.total)}</strong>
        </div>
      </div>
      ${footer(pageNumber, totalPages)}
    </section>`;
}

function renderPreview() {
  const preview = $('#documentPreview');
  if (!preview) return;

  const totals = totalData();
  const rows = state.items.length
    ? state.items.map((item, index) => `<tr><td>${esc(item.code || String(index + 1).padStart(2, '0'))}</td><td>${esc(item.description)}</td><td class="right">${item.qty}</td><td class="right">${money(item.unit)}</td><td class="right"><b>${money(item.qty * item.unit)}</b></td></tr>`).join('')
    : '<tr><td colspan="5">Nenhum item adicionado.</td></tr>';

  const solutionChunks = splitTextToFit(val('solution'), [
    { widthMm: 96, heightMm: 24, fontPx: 10, lineHeight: 1.48 },
    { widthMm: 168, heightMm: 174, fontPx: 10, lineHeight: 1.58 }
  ]);
  const firstSolution = solutionChunks[0] || '';
  const continuationChunks = solutionChunks.slice(1);
  const totalPages = 3 + continuationChunks.length;
  const equipmentPage = 2 + continuationChunks.length;
  const commercialPage = 3 + continuationChunks.length;

  const pageCount = $('#previewPageCount');
  if (pageCount) pageCount.textContent = `Formato A4 • ${totalPages} ${totalPages === 1 ? 'página' : 'páginas'}`;

  const continuationHtml = continuationChunks.map((text, index) => solutionContinuationPage(
    text,
    index + 2,
    totalPages,
    totals,
    index + 1
  )).join('');

  preview.innerHTML = `
    <section class="doc-page page-cover">
      ${header('ORÇAMENTO COMERCIAL', 'Proposta profissional de equipamento industrial')}
      <div class="doc-body">
        <div class="eyebrow">PROPOSTA COMERCIAL</div>
        <div class="machine-name">${esc(val('machineName') || 'EQUIPAMENTO INDUSTRIAL')}</div>
        <div class="meta">
          <div class="meta-cell"><span>ORÇAMENTO Nº</span><strong>${esc(val('quoteNumber'))}</strong></div>
          <div class="meta-cell"><span>DATA</span><strong>${formatDate(val('quoteDate'))}</strong></div>
          <div class="meta-cell"><span>VALIDADE</span><strong>${esc(val('validity'))}</strong></div>
          <div class="meta-cell"><span>RESPONSÁVEL</span><strong>${esc(val('responsible'))}</strong></div>
        </div>
        <div class="client-strip">
          <div><span>CLIENTE / EMPRESA</span><strong>${esc(val('clientName'))}</strong></div>
          <div><span>CNPJ / CPF</span><strong>${esc(val('clientDoc'))}</strong></div>
          <div><span>CONTATO</span><strong>${esc(val('clientPhone'))}</strong></div>
        </div>
        ${imageHTML('heroImage', 'hero')}
        <div class="proposal-grid">
          <div class="doc-section solution-main-card">
            <h2>SOLUÇÃO PROPOSTA</h2>
            <div class="doc-text solution-main-text">${esc(firstSolution)}</div>
            ${continuationChunks.length ? `<div class="solution-continues">Continua na página 2.</div>` : ''}
          </div>
          <aside class="investment">
            <span>INVESTIMENTO TOTAL</span>
            <strong>${money(totals.total)}</strong>
            <small>Condições comerciais detalhadas na página ${commercialPage}.</small>
          </aside>
        </div>
        <div class="scope"><span>ESCOPO RESUMIDO</span><div class="doc-text">${esc(val('scopeSummary'))}</div></div>
      </div>
      ${footer(1, totalPages)}
    </section>

    ${continuationHtml}

    <section class="doc-page page-equipment">
      ${header('EQUIPAMENTO OFERTADO', 'Fotos, aplicação e especificações principais')}
      <div class="doc-body">
        <div class="gallery">${imageHTML('gallery1')}<div class="gallery-side">${imageHTML('gallery2')}${imageHTML('gallery3')}</div></div>
        <div class="doc-section"><h2>APLICAÇÃO</h2><div class="doc-text">${esc(val('application'))}</div></div>
        <div class="doc-section"><h2>ESPECIFICAÇÕES PRINCIPAIS</h2><div class="specs">${[['MODELO', 'model'], ['POTÊNCIA', 'power'], ['ÁREA DE TRABALHO', 'workArea'], ['PRODUÇÃO', 'production'], ['ALIMENTAÇÃO', 'voltage'], ['MATERIAL PRINCIPAL', 'material']].map(([label, id]) => `<div class="spec"><span>${label}</span><strong>${esc(val(id))}</strong></div>`).join('')}</div></div>
        <div class="doc-section"><h2>ITENS INCLUSOS</h2><table class="items-table"><thead><tr><th>ITEM</th><th>DESCRIÇÃO</th><th class="right">QTD.</th><th class="right">VALOR UNIT.</th><th class="right">TOTAL</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="differentials"><b>DIFERENCIAIS</b> &nbsp; ✓ Construção robusta &nbsp; ✓ Manutenção simplificada &nbsp; ✓ Assistência técnica BRUTUSMAQ</div>
      </div>
      ${footer(equipmentPage, totalPages)}
    </section>

    <section class="doc-page page-commercial">
      ${header('CONDIÇÕES COMERCIAIS', 'Informações finais para fechamento da proposta')}
      <div class="doc-body">
        <div class="total-banner"><span>VALOR TOTAL DA PROPOSTA</span><strong>${money(totals.total)}</strong></div>
        <div class="commercial">${[['PRAZO DE FABRICAÇÃO / ENTREGA', 'delivery'], ['FORMA DE PAGAMENTO', 'payment'], ['FRETE', 'freightCondition'], ['INSTALAÇÃO / COMISSIONAMENTO', 'installation'], ['GARANTIA', 'warranty'], ['ASSISTÊNCIA TÉCNICA', 'support']].map(([label, id]) => `<div class="commercial-card"><span>${label}</span><p>${esc(val(id))}</p></div>`).join('')}</div>
        <div class="summary-values"><div class="sum-card"><span>SUBTOTAL</span><strong>${money(totals.subtotal)}</strong></div><div class="sum-card"><span>DESCONTO</span><strong>${money(totals.discount)}</strong></div><div class="sum-card"><span>FRETE</span><strong>${money(totals.freight)}</strong></div><div class="sum-card final"><span>TOTAL FINAL</span><strong>${money(totals.total)}</strong></div></div>
        <div class="doc-section"><h2>OBSERVAÇÕES COMERCIAIS</h2><div class="doc-text">${esc(val('notes'))}</div></div>
        <div class="approval"><div class="doc-section"><h2>APROVAÇÃO DO CLIENTE</h2></div><div class="approval-grid"><div class="signature">NOME / EMPRESA</div><div class="signature">CNPJ / CPF</div><div class="signature">DATA</div><div class="signature">ASSINATURA / ACEITE</div></div></div>
      </div>
      ${footer(commercialPage, totalPages)}
    </section>`;
}

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function collect() {
  const fields = {};
  fieldIds.forEach(id => { fields[id] = val(id); });
  return {
    version: 2,
    fields,
    items: state.items,
    images: state.images,
    savedAt: new Date().toISOString()
  };
}

function apply(data = {}) {
  Object.entries(data.fields || {}).forEach(([id, value]) => {
    const element = $(`#${id}`);
    if (element) element.value = value;
  });

  const preferredName = preferredEquipmentName(data);
  const machineInput = $('#machineName');
  if (machineInput && isGenericQuoteText(machineInput.value, data.fields?.clientName || '')) {
    machineInput.value = preferredName;
  }

  state.items = normalizeImportedItems(data.items, {
    ...data,
    fields: {
      ...(data.fields || {}),
      machineName: machineInput?.value || preferredName
    }
  });
  state.images = data.images || {};

  if (!state.items.length) {
    const importedTotal = Number(data.fields?.finalValue || data.fields?.total || 0);
    state.items = [normalizeItem({ description: preferredName, qty: 1, unit: importedTotal }, 0, preferredName)];
  }

  renderItems();
  renderPreview();
}

function crmImport() {
  const match = location.hash.match(/(?:^#|&)crm=([^&]+)/);
  if (!match) return null;

  try {
    let encoded = match[1].replaceAll('-', '+').replaceAll('_', '/');
    while (encoded.length % 4) encoded += '=';
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return data && data.source === 'BRUTUSMAQ_CRM' && data.fields ? data : null;
  } catch (error) {
    return null;
  }
}

function autosave() {
  clearTimeout(autosave.timer);
  autosave.timer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(collect()));
    } catch (error) {
      // O salvamento automático não deve interromper a edição.
    }
  }, 400);
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(collect()));
    toast('Orçamento salvo neste navegador.');
  } catch (error) {
    toast('Não foi possível salvar. Reduza o tamanho das imagens.');
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `orcamento-${val('quoteNumber') || 'brutusmaq'}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function reset() {
  if (!confirm('Criar um novo orçamento e limpar o atual?')) return;
  localStorage.removeItem(STORE);
  location.reload();
}

function compressImage(file, callback) {
  const image = new Image();
  const reader = new FileReader();
  reader.onload = () => { image.src = reader.result; };
  image.onload = () => {
    const maxSize = 1600;
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL('image/jpeg', 0.84));
  };
  reader.readAsDataURL(file);
}

$$('.section-toggle').forEach(button => {
  button.onclick = () => {
    const section = button.closest('.editor-section');
    section.classList.toggle('open');
    $('b', button).textContent = section.classList.contains('open') ? '−' : '+';
  };
});

$$('[data-view]').forEach(button => {
  button.onclick = () => {
    $$('[data-view]').forEach(row => row.classList.remove('active'));
    button.classList.add('active');
    $('#workspace').className = `workspace ${button.dataset.view}`;
  };
});

fieldIds.forEach(id => {
  $(`#${id}`)?.addEventListener('input', () => {
    renderPreview();
    autosave();
  });
});

$$('input[type=file][data-image]').forEach(input => {
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    compressImage(file, source => {
      state.images[input.dataset.image] = source;
      renderPreview();
      autosave();
      toast('Foto atualizada.');
    });
  };
});

bindItemEditorEvents();

$('#addItemBtn').onclick = () => addItem();
$('#saveBtn').onclick = save;
$('#newBtn').onclick = reset;
$('#exportBtn').onclick = exportData;
$('#pdfBtn').onclick = () => {
  renderPreview();
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
};

$('#importInput').onchange = () => {
  const file = $('#importInput').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      apply(JSON.parse(reader.result));
      save();
      toast('Dados importados.');
    } catch (error) {
      toast('Arquivo inválido.');
    }
  };
  reader.readAsText(file);
};

if (!val('quoteDate')) {
  $('#quoteDate').value = new Date().toISOString().slice(0, 10);
}

try {
  const imported = crmImport();
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (imported) {
    apply(imported);
    localStorage.setItem(STORE, JSON.stringify(collect()));
    setTimeout(() => toast('Dados do CRM carregados no orçamento.'), 250);
  } else if (saved) {
    apply(saved);
  } else {
    addItem({ description: 'Equipamento principal', qty: 1, unit: 0 });
    addItem({ description: 'Acessório incluso', qty: 1, unit: 0 });
  }
} catch (error) {
  addItem({ description: 'Equipamento principal', qty: 1, unit: 0 });
}

renderPreview();
