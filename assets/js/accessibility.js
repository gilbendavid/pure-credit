/**
 * Loads the pinned OpenNagish build without delaying the page, then applies
 * Pure Credit colors inside the widget's isolated Shadow DOM.
 */
if (!document.getElementById('opennagish-loader')) {
  window.OpenNagishConfig = {
    position: 'bottom-left',
    lang: 'he',
    bottomOffset: 12,
    // The library adds a 20px base offset; this lifts it above mobile safe areas.
    mobileBottomOffset: 30,
  };

  const script = document.createElement('script');
  script.id = 'opennagish-loader';
  script.src =
    'https://cdn.jsdelivr.net/npm/open-nagish@1.1.5/dist/open-nagish.min.js';
  script.async = true;
  script.addEventListener('load', () => {
    const shadowRoot = document.getElementById('opennagish-widget')?.shadowRoot;
    if (!shadowRoot || shadowRoot.getElementById('pure-credit-widget-theme')) return;

    const theme = document.createElement('style');
    theme.id = 'pure-credit-widget-theme';
    theme.textContent = `
      .anid-trigger, .anid-panel-header { background: #1b2b52 !important; }
      .anid-trigger[aria-expanded="true"] { background: #8a6a22 !important; }
      .anid-trigger:focus-visible, .anid-close-btn:focus-visible,
      .anid-category-header:focus-visible, .anid-btn:focus-visible,
      .anid-toggle input:focus-visible, .anid-lang-select:focus-visible {
        outline: 3px solid #1b2b52 !important;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px #fff !important;
      }
    `;
    shadowRoot.append(theme);
  });
  document.head.append(script);
}
