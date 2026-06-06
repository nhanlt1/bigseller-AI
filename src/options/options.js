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

const optimizeMaxKeywordsInput = document.getElementById('optimizeMaxKeywords');

const optimizeMinSoldInput = document.getElementById('optimizeMinSold');

const optimizeMaxCompetitorsPerKeywordInput = document.getElementById('optimizeMaxCompetitorsPerKeyword');

const optimizeNavigateDelayMsInput = document.getElementById('optimizeNavigateDelayMs');

const optimizeScrollStepDelayMsInput = document.getElementById('optimizeScrollStepDelayMs');

const optimizeBetweenKeywordDelayMsInput = document.getElementById('optimizeBetweenKeywordDelayMs');

const optimizeMinProductCardsInput = document.getElementById('optimizeMinProductCards');

const optimizeKeywordPromptInput = document.getElementById('optimizeKeywordPrompt');

const optimizeAnalysisPromptInput = document.getElementById('optimizeAnalysisPrompt');

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

    if (optimizeMaxKeywordsInput)

        optimizeMaxKeywordsInput.value = String(currentSettings.optimizeMaxKeywords ?? 8);

    if (optimizeMinSoldInput)

        optimizeMinSoldInput.value = String(currentSettings.optimizeMinSold ?? DEFAULT_SETTINGS.optimizeMinSold);

    if (optimizeMaxCompetitorsPerKeywordInput)

        optimizeMaxCompetitorsPerKeywordInput.value = String(
            currentSettings.optimizeMaxCompetitorsPerKeyword ??
                DEFAULT_SETTINGS.optimizeMaxCompetitorsPerKeyword,
        );

    if (optimizeNavigateDelayMsInput)

        optimizeNavigateDelayMsInput.value = String(currentSettings.optimizeNavigateDelayMs ?? 1000);

    if (optimizeScrollStepDelayMsInput)

        optimizeScrollStepDelayMsInput.value = String(currentSettings.optimizeScrollStepDelayMs ?? 900);

    if (optimizeBetweenKeywordDelayMsInput)

        optimizeBetweenKeywordDelayMsInput.value = String(currentSettings.optimizeBetweenKeywordDelayMs ?? 2000);

    if (optimizeMinProductCardsInput)

        optimizeMinProductCardsInput.value = String(currentSettings.optimizeMinProductCards ?? 50);

    if (optimizeKeywordPromptInput)

        optimizeKeywordPromptInput.value = currentSettings.optimizeKeywordPrompt ?? '';

    if (optimizeAnalysisPromptInput)

        optimizeAnalysisPromptInput.value = currentSettings.optimizeAnalysisPrompt ?? '';

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

            optimizeMaxKeywords: Number(optimizeMaxKeywordsInput?.value) || DEFAULT_SETTINGS.optimizeMaxKeywords,

            optimizeMinSold: Number(optimizeMinSoldInput?.value) || 0,

            optimizeMaxCompetitorsPerKeyword:
                Number(optimizeMaxCompetitorsPerKeywordInput?.value) ||
                DEFAULT_SETTINGS.optimizeMaxCompetitorsPerKeyword,

            optimizeNavigateDelayMs: Number(optimizeNavigateDelayMsInput?.value) || DEFAULT_SETTINGS.optimizeNavigateDelayMs,

            optimizeScrollStepDelayMs: Number(optimizeScrollStepDelayMsInput?.value) || DEFAULT_SETTINGS.optimizeScrollStepDelayMs,

            optimizeBetweenKeywordDelayMs: Number(optimizeBetweenKeywordDelayMsInput?.value) || DEFAULT_SETTINGS.optimizeBetweenKeywordDelayMs,

            optimizeMinProductCards: Number(optimizeMinProductCardsInput?.value) || DEFAULT_SETTINGS.optimizeMinProductCards,

            optimizeKeywordPrompt: optimizeKeywordPromptInput?.value ?? '',

            optimizeAnalysisPrompt: optimizeAnalysisPromptInput?.value ?? '',

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


