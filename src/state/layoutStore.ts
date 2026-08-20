export type MobileDrawerType = 'none' | 'transcript' | 'tasks';

export interface LayoutSnapshot {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  mobileDrawer: MobileDrawerType;
}

export type LayoutListener = (snapshot: LayoutSnapshot) => void;

export class LayoutStore {
  private isLeftPanelOpen: boolean;
  private isRightPanelOpen: boolean;
  private mobileDrawer: MobileDrawerType = 'none';
  private listeners: Set<LayoutListener> = new Set();

  constructor(options: { defaultLeftOpen?: boolean; defaultRightOpen?: boolean } = {}) {
    this.isLeftPanelOpen = options.defaultLeftOpen ?? true;
    this.isRightPanelOpen = options.defaultRightOpen ?? true;
  }

  public toggleLeftPanel(): void {
    this.isLeftPanelOpen = !this.isLeftPanelOpen;
    this.notify();
  }

  public setLeftPanelOpen(open: boolean): void {
    this.isLeftPanelOpen = open;
    this.notify();
  }

  public toggleRightPanel(): void {
    this.isRightPanelOpen = !this.isRightPanelOpen;
    this.notify();
  }

  public setRightPanelOpen(open: boolean): void {
    this.isRightPanelOpen = open;
    this.notify();
  }

  public setMobileDrawer(drawer: MobileDrawerType): void {
    this.mobileDrawer = drawer;
    this.notify();
  }

  public closeMobileDrawer(): void {
    this.mobileDrawer = 'none';
    this.notify();
  }

  public getSnapshot(): LayoutSnapshot {
    return {
      isLeftPanelOpen: this.isLeftPanelOpen,
      isRightPanelOpen: this.isRightPanelOpen,
      mobileDrawer: this.mobileDrawer,
    };
  }

  public subscribe(listener: LayoutListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((l) => l(snap));
  }
}
