// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { FloatingPanel } from '../src/content/floating-panel';
import { Profile, DEFAULT_APP_STATE } from '../src/models/schema';

describe('FloatingPanel Mounting and Visibility', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should mount host element to document.body with visible positioning', () => {
    const profile: Profile = DEFAULT_APP_STATE.profiles[0];
    const settings = DEFAULT_APP_STATE.settings;
    const formState = { pilgrimRowsCount: 1, elements: [] };

    const panel = new FloatingPanel(
      () => {},
      () => {},
      () => {},
      () => {},
      () => formState,
      () => {}
    );

    panel.mount(profile, settings, formState);

    const host = document.querySelector('pilgrim-quickfill-root') as HTMLElement;
    expect(host).not.toBeNull();
    console.log('Host style:', {
      position: host.style.position,
      bottom: host.style.bottom,
      right: host.style.right,
      top: host.style.top,
      left: host.style.left,
      display: host.style.display,
      zIndex: host.style.zIndex
    });

    const shadow = host.shadowRoot;
    expect(shadow).not.toBeNull();
    const panelEl = shadow?.querySelector('.panel');
    expect(panelEl).not.toBeNull();
    expect(host.style.bottom).toBe('20px');
    expect(host.style.right).toBe('20px');

    panel.destroy();
  });

  it('should ignore corrupted or off-screen sessionStorage and safely default to bottom-right', () => {
    sessionStorage.setItem('pilgrim_quickfill_pos', JSON.stringify({ top: -9999, left: -9999 }));
    
    const profile: Profile = DEFAULT_APP_STATE.profiles[0];
    const settings = DEFAULT_APP_STATE.settings;
    const formState = { pilgrimRowsCount: 1, elements: [] };

    const panel = new FloatingPanel(
      () => {},
      () => {},
      () => {},
      () => {},
      () => formState,
      () => {}
    );

    panel.mount(profile, settings, formState);

    const host = document.querySelector('pilgrim-quickfill-root') as HTMLElement;
    expect(host.style.bottom).toBe('20px');
    expect(host.style.right).toBe('20px');

    panel.destroy();
    sessionStorage.clear();
  });
});
