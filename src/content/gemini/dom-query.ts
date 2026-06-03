import {
  GEMINI_GENERATING_SELECTORS,
  GEMINI_MODEL_RESPONSE_SELECTOR,
} from './selectors';

const THOUGHTS_ANCESTOR =
  'model-thoughts, .thoughts-container, .thoughts-content, [class*="thoughts-panel"]';

function isInsideThoughts(el: Element): boolean {
  return !!el.closest(THOUGHTS_ANCESTOR);
}

function walkShadowHosts(el: Element, selector: string, out: HTMLElement[]): void {
  const shadow = el.shadowRoot;
  if (shadow) {
    out.push(...shadow.querySelectorAll<HTMLElement>(selector));
    for (const child of shadow.children) {
      if (child instanceof Element) walkShadowHosts(child, selector, out);
    }
  }
  for (const child of el.children) {
    if (child instanceof Element) walkShadowHosts(child, selector, out);
  }
}

/** querySelectorAll kèm duyệt shadow DOM (Gemini dùng web components). */
export function queryAllDeep(
  root: ParentNode,
  selector: string,
): HTMLElement[] {
  const found: HTMLElement[] = [];
  found.push(...root.querySelectorAll<HTMLElement>(selector));

  const hosts =
    root instanceof Element
      ? [root]
      : Array.from(root.querySelectorAll<HTMLElement>('*'));

  for (const host of hosts) {
    walkShadowHosts(host, selector, found);
  }

  return [...new Set(found)];
}

/** Bỏ phần tử cha khi con cũng khớp selector (tránh đếm đôi structured-content + message-content). */
export function dedupeNestedBubbles(nodes: HTMLElement[]): HTMLElement[] {
  return nodes.filter(
    (el) => !nodes.some((other) => other !== el && el.contains(other)),
  );
}

export function getModelResponseElements(scope: ParentNode): HTMLElement[] {
  const raw = queryAllDeep(scope, GEMINI_MODEL_RESPONSE_SELECTOR);
  const filtered = raw.filter((el) => !isInsideThoughts(el));
  return dedupeNestedBubbles(filtered);
}

export function isGeminiGenerating(): boolean {
  for (const selector of GEMINI_GENERATING_SELECTORS) {
    const matches = queryAllDeep(document, selector);
    for (const btn of matches) {
      if (btn instanceof HTMLButtonElement && !btn.disabled) return true;
    }
  }
  return false;
}
