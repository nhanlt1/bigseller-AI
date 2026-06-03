import { bigsellerAdapter } from './adapter';
import { listenForProductApply } from '../shared/apply-listener';
import { mountImageFab } from '../shared/image-fab';
import { FloatingPanel, mountToggleButton } from '../shared/panel';
import { mountPricingFab } from '../shared/pricing-popup';
import { observeDomChanges } from '../shared/dom-utils';

listenForProductApply(bigsellerAdapter);

function init(): void {
  if (!bigsellerAdapter.canHandle(location.href)) return;
  if (!bigsellerAdapter.extract()) return;

  mountPricingFab();
  mountImageFab(bigsellerAdapter);
  const panel = new FloatingPanel(bigsellerAdapter);
  mountToggleButton(panel);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

observeDomChanges(() => {
  if (
    !document.getElementById('bigseller-ai-toggle') ||
    !document.getElementById('bigseller-ai-pricing-fab') ||
    !document.getElementById('bigseller-ai-image-fab')
  ) {
    init();
  }
});
