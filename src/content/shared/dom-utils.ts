export function queryFirst<T extends Element>(
  selectors: string[],
  root: ParentNode = document,
): T | null {
  for (const selector of selectors) {
    const el = root.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

export function getInputValue(el: HTMLInputElement | HTMLTextAreaElement): string {
  return el.value?.trim() ?? '';
}

export function setInputValue(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function getPlainTextContainerValue(el: Element): string {
  return (el.textContent ?? '').trim();
}

export function setPlainTextContainerValue(el: Element, text: string): void {
  const target =
    el instanceof HTMLElement && el.isContentEditable
      ? el
      : (el.querySelector('[contenteditable="true"]') as HTMLElement | null) ??
        (el as HTMLElement);
  target.focus?.();
  if (target.isContentEditable) {
    target.innerText = text;
    target.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else {
    target.textContent = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function getQuillText(container: ParentNode): string {
  const editor = container.querySelector('.ql-editor');
  if (!editor) return '';
  return (editor.textContent ?? editor.innerHTML).trim();
}

export function setQuillText(container: ParentNode, text: string): void {
  const editor = container.querySelector('.ql-editor') as HTMLElement | null;
  if (!editor) return;
  editor.focus();
  editor.innerHTML = '';
  const paragraphs = text.split(/\n/);
  for (const line of paragraphs) {
    const p = document.createElement('p');
    p.textContent = line;
    editor.appendChild(p);
  }
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

export function waitForElement<T extends Element>(
  selectors: string[],
  timeoutMs = 15000,
  root: ParentNode = document,
): Promise<T | null> {
  return new Promise((resolve) => {
    const existing = queryFirst<T>(selectors, root);
    if (existing) {
      resolve(existing);
      return;
    }

    const deadline = Date.now() + timeoutMs;
    const observer = new MutationObserver(() => {
      const el = queryFirst<T>(selectors, root);
      if (el) {
        observer.disconnect();
        resolve(el);
      } else if (Date.now() > deadline) {
        observer.disconnect();
        resolve(null);
      }
    });

    observer.observe(root === document ? document.body : (root as Element), {
      childList: true,
      subtree: true,
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(queryFirst<T>(selectors, root));
    }, timeoutMs);
  });
}

export function observeDomChanges(callback: () => void): () => void {
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      callback();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
