import { evaluateFormula, formatVnd } from '../pricing/formula-engine.js';
import { PRICING_VARIABLE_LABELS } from '../pricing/default-variables.js';
import { DEFAULT_SETTINGS, getSettings, saveSettings, } from '../shared/storage.js';
const form = document.getElementById('settings-form');
const languageInput = document.getElementById('language');
const promptInput = document.getElementById('promptTemplate');
const formulaInput = document.getElementById('pricingFormula');
const variablesGrid = document.getElementById('variables-grid');
const formulaPreview = document.getElementById('formula-preview');
const statusEl = document.getElementById('status');
const resetBtn = document.getElementById('reset-btn');
let currentSettings = { ...DEFAULT_SETTINGS };
function renderVariables(vars) {
    variablesGrid.innerHTML = Object.keys(vars)
        .map((key) => `
      <label>
        ${PRICING_VARIABLE_LABELS[key] ?? key}
        <input type="number" step="any" data-var="${key}" value="${vars[key]}" />
      </label>
    `)
        .join('');
}
function readVariables() {
    const vars = { ...currentSettings.pricingVariables };
    variablesGrid.querySelectorAll('input[data-var]').forEach((el) => {
        const key = el.dataset.var;
        vars[key] = Number(el.value);
    });
    return vars;
}
function updateFormulaPreview() {
    try {
        const vars = readVariables();
        const price = evaluateFormula(formulaInput.value, vars);
        formulaPreview.textContent = `Ví dụ: ${formatVnd(price)}`;
        formulaPreview.classList.remove('error');
    }
    catch (err) {
        formulaPreview.textContent =
            err instanceof Error ? err.message : 'Công thức không hợp lệ';
        formulaPreview.classList.add('error');
    }
}
async function load() {
    currentSettings = await getSettings();
    languageInput.value = currentSettings.language;
    promptInput.value = currentSettings.promptTemplate;
    formulaInput.value = currentSettings.pricingFormula;
    renderVariables(currentSettings.pricingVariables);
    updateFormulaPreview();
}
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Đang lưu…';
    try {
        await saveSettings({
            language: languageInput.value.trim() || 'Việt',
            promptTemplate: promptInput.value,
            pricingFormula: formulaInput.value.trim(),
            pricingVariables: readVariables(),
        });
        statusEl.textContent = 'Đã lưu!';
        setTimeout(() => {
            statusEl.textContent = '';
        }, 2000);
    }
    catch {
        statusEl.textContent = 'Lỗi khi lưu';
    }
});
resetBtn.addEventListener('click', async () => {
    currentSettings = { ...DEFAULT_SETTINGS };
    await load();
    statusEl.textContent = 'Đã khôi phục (nhấn Lưu để ghi)';
});
formulaInput.addEventListener('input', updateFormulaPreview);
variablesGrid.addEventListener('input', updateFormulaPreview);
void load();
