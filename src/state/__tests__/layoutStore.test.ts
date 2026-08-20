import { describe, it, expect } from 'vitest';
import { LayoutStore } from '../layoutStore';

describe('LayoutStore (FEAT-011)', () => {
  it('manages desktop panels and mobile drawer states', () => {
    const layout = new LayoutStore({ defaultLeftOpen: true, defaultRightOpen: true });

    expect(layout.getSnapshot().isLeftPanelOpen).toBe(true);
    expect(layout.getSnapshot().isRightPanelOpen).toBe(true);
    expect(layout.getSnapshot().mobileDrawer).toBe('none');

    // Toggle panels
    layout.toggleLeftPanel();
    expect(layout.getSnapshot().isLeftPanelOpen).toBe(false);

    layout.toggleRightPanel();
    expect(layout.getSnapshot().isRightPanelOpen).toBe(false);

    // Mobile drawer
    layout.setMobileDrawer('transcript');
    expect(layout.getSnapshot().mobileDrawer).toBe('transcript');

    layout.closeMobileDrawer();
    expect(layout.getSnapshot().mobileDrawer).toBe('none');
  });
});
