import { queryFirst, waitForElement } from '../shared/dom-utils';

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  '[id="prompt-textarea"]',
  'div#prompt-textarea[contenteditable="true"]',
  'form.group\\/composer [contenteditable="true"]',
  '.ProseMirror[contenteditable="true"]',
  '[data-testid="composer-text-input"]',
  '[aria-label="Trò chuyện với ChatGPT"][contenteditable="true"]',
  'textarea[name="prompt-textarea"]',
];

export async function fillChatGPTComposer(prompt: string): Promise<HTMLElement> {
  const editor = await waitForElement<HTMLElement>(COMPOSER_SELECTORS, 20000);
  if (!editor) {
    throw new Error('Không tìm thấy ô nhập ChatGPT (#prompt-textarea)');
  }

  const editable = resolveEditable(editor);
  await focusComposerEditor(editable);
  setProseMirrorText(editable, prompt);
  await sleep(150);
  await focusComposerEditor(editable);
  return editable;
}

function resolveEditable(editor: HTMLElement): HTMLElement {
  if (editor.isContentEditable) return editor;
  return (
    (editor.querySelector('[contenteditable="true"]') as HTMLElement | null) ??
    editor
  );
}

async function focusComposerEditor(
  passed?: HTMLElement,
): Promise<HTMLElement> {
  const root =
    passed ??
    queryFirst<HTMLElement>(COMPOSER_SELECTORS) ??
    (await waitForElement<HTMLElement>(COMPOSER_SELECTORS, 8000));

  if (!root) throw new Error('Không tìm thấy khung chat ChatGPT');

  const editable = resolveEditable(root);
  editable.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(50);
  editable.focus({ preventScroll: true });
  await sleep(100);
  return editable;
}

function setProseMirrorText(root: HTMLElement, text: string): void {
  root.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (document.execCommand('insertText', false, text)) {
    root.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return;
  }
  root.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = text;
  root.appendChild(p);
  root.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
