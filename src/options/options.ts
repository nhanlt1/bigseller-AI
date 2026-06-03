import { evaluateFormula, formatVnd } from '../pricing/formula-engine';
import { PRICING_VARIABLE_LABELS } from '../pricing/default-variables';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
} from '../shared/storage';
import type { ExtensionSettings, PricingVariables } from '../shared/types';

const form = document.getElementById('settings-form') as HTMLFormElement;
const languageInput = document.getElementById('language') as HTMLInputElement;
const promptInput = document.getElementById('promptTemplate') as HTMLTextAreaElement;
const formulaInput = document.getElementById('pricingFormula') as HTMLInputElement;
const variablesGrid = document.getElementById('variables-grid')!;
const formulaPreview = document.getElementById('formula-preview')!;
const statusEl = document.getElementById('status')!;
const resetBtn = document.getElementById('reset-btn')!;

let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };

function renderVariables(vars: PricingVariables): void {
  variablesGrid.innerHTML = Object.keys(vars)
    .map(
      (key) => `
      <label>
        ${PRICING_VARIABLE_LABELS[key] ?? key}
        <input type="number" step="any" data-var="${key}" value="${vars[key]}" />
      </label>
    `,
    )
    .join('');
}

function readVariables(): PricingVariables {
  const vars = { ...currentSettings.pricingVariables };
  variablesGrid.querySelectorAll('input[data-var]').forEach((el) => {
    const key = (el as HTMLInputElement).dataset.var!;
    vars[key] = Number((el as HTMLInputElement).value);
  });
  return vars;
}

function updateFormulaPreview(): void {
  try {
    const vars = readVariables();
    const price = evaluateFormula(formulaInput.value, vars);
    formulaPreview.textContent = `Ví dụ: ${formatVnd(price)}`;
    formulaPreview.classList.remove('error');
  } catch (err) {
    formulaPreview.textContent =
      err instanceof Error ? err.message : 'Công thức không hợp lệ';
    formulaPreview.classList.add('error');
  }
}

async function load(): Promise<void> {
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
  } catch {
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
