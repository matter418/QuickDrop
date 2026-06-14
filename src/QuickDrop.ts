import { Plugin, SettingsTypes } from "@ryelite/core";
import { ContextMenuManager } from "@ryelite/core";

// --- DOM selectors ----------------------------------------------------------
const SLOT_SELECTOR = ".hs-inventory-item";
const INVENTORY_TABLE_SELECTOR = ".hs-item-table--inventory";
const BANK_MENU_ID = "hs-bank-menu";

// --- Mouse buttons (PointerEvent.button) ------------------------------------
const MOUSE_LEFT = 0 as const;
const MOUSE_RIGHT = 2 as const;

// --- Drop action ------------------------------------------------------------
// The game's numeric id for the inventory "Drop" action (drops the whole stack
// with no prompt). Discovered by logging the context-menu rows: the plain "Drop"
// row is action 2 with a null amount, while "Drop X" (the quantity prompt) is a
// separate action 18 / amount "X" — matching by id 2 deliberately avoids that.
const DROP_ACTION_ID: number | null = 2;

// --- Drop triggers ----------------------------------------------------------
// Labels are intentionally terse (they appear verbatim in the settings dropdown);
// the trailing comment spells out the gesture each one maps to.
const TRIGGER_LEFT = "Left click"; // plain left click
const TRIGGER_RIGHT = "Right click"; // plain right click (replaces the context menu)
const TRIGGER_SHIFT = "Shift+Left click"; // shift + left click (default)
// Note: deliberately no "Alt" option. Alt is Electron's menu-accelerator key, so
// holding it makes altKey unreliable on pointer events (the modifier gets eaten
// at the window level) — drops would fire only intermittently.
const TRIGGER_OPTIONS = [TRIGGER_LEFT, TRIGGER_RIGHT, TRIGGER_SHIFT];

/**
 * Quick Drop — drop an inventory item with a single configurable click instead
 * of opening the right-click context menu.
 *
 * Mechanism (shared with Quick Deposit): a capture-phase pointer listener detects
 * the configured trigger on an inventory slot and suppresses it, then synthesizes
 * a right-click so the game builds its context menu. A hook on the menu builder
 * captures the "Drop" row's element, which we then synth-click — all within one
 * animation frame, so the menu never visibly appears.
 */
export default class QuickDrop extends Plugin {
    pluginName = "Quick Drop";
    author = "matter";
    contextMenuManager: ContextMenuManager = new ContextMenuManager();

    private hookInstalled = false;
    private pointerListener: ((e: PointerEvent) => void) | null = null;

    // Set while we drive the game's context menu programmatically, so our own
    // pointer listener and menu hook know to step aside. capturedContainer holds
    // the Drop row's element found during that flow.
    private inSyntheticFlow = false;
    private capturedContainer: HTMLElement | null = null;

    constructor() {
        super();

        this.settings.trigger = {
            text: "Drop with",
            description:
                "Which click drops the item: Left click, Right click, or Shift+Left click.",
            type: SettingsTypes.combobox,
            value: TRIGGER_SHIFT,
            options: TRIGGER_OPTIONS,
            callback: () => {},
        };
    }

    // --- Plugin lifecycle ---------------------------------------------------

    init(): void {
        this.log("Initialized");
    }

    start(): void {
        this.log("Started");
        this.installMenuHook();
        this.installPointerListener();
    }

    stop(): void {
        this.log("Stopped");
        this.removePointerListener();
    }

    // --- Input listener -----------------------------------------------------

    private installPointerListener(): void {
        if (this.pointerListener) return;

        const handler = (e: PointerEvent) => {
            if (this.inSyntheticFlow) return;
            if (!this.settings.enable?.value) return;
            if (!this.matchesTrigger(e)) return;

            const target = (e.target as HTMLElement | null) ?? null;
            const slotEl = target?.closest(SLOT_SELECTOR) as HTMLElement | null;
            if (!slotEl) return;
            if (!slotEl.closest(INVENTORY_TABLE_SELECTOR)) return;

            // The "Drop" action only exists in the normal inventory context. When
            // the bank is open an inventory click means deposit, so leave it alone
            // and let the game handle it.
            if (document.getElementById(BANK_MENU_ID)) return;

            e.preventDefault();
            e.stopPropagation();

            this.runSyntheticFlow(slotEl).catch((err) =>
                this.error("Quick drop failed:", err)
            );
        };

        this.pointerListener = handler;
        document.addEventListener("pointerdown", handler, true);
    }

    private removePointerListener(): void {
        if (!this.pointerListener) return;
        document.removeEventListener("pointerdown", this.pointerListener, true);
        this.pointerListener = null;
    }

    // --- Trigger matching ---------------------------------------------------

    private triggerMode(): string {
        return String(this.settings.trigger?.value ?? TRIGGER_SHIFT);
    }

    /** Does this pointer event match the configured drop trigger? */
    private matchesTrigger(e: PointerEvent): boolean {
        switch (this.triggerMode()) {
            case TRIGGER_LEFT:
                return e.button === MOUSE_LEFT;
            case TRIGGER_RIGHT:
                return e.button === MOUSE_RIGHT;
            case TRIGGER_SHIFT:
                return e.button === MOUSE_LEFT && e.shiftKey;
            default:
                return false;
        }
    }

    // --- Context-menu hook --------------------------------------------------

    private installMenuHook(): void {
        if (this.hookInstalled) return;
        const self = this;

        this.contextMenuManager.registerContextHook(
            "ContextMenuItemManager",
            "_createInventoryItemContextMenuItems",
            function (_args: any, result: any) {
                if (!Array.isArray(result) || !self.inSyntheticFlow) {
                    return result;
                }
                const target = result.find((it: any) => it && self.isDropItem(it));
                if (target?._container) {
                    self.capturedContainer = target._container as HTMLElement;
                }
                return result;
            }
        );

        this.hookInstalled = true;
    }

    /**
     * Identify the plain "Drop" row (drops the whole stack, no prompt). Prefer the
     * numeric action id; the text fallback also requires a null amount so it skips
     * the "Drop X" quantity-prompt row, which shares the "Drop" label but carries
     * an amount of "X".
     */
    private isDropItem(it: any): boolean {
        if (DROP_ACTION_ID !== null) {
            return it._itemAction === DROP_ACTION_ID;
        }
        if (it._itemActionAmount) return false;
        const text = (it._container as HTMLElement | undefined)?.textContent ?? "";
        return text.replace(/\s+/g, "").toLowerCase().startsWith("drop");
    }

    // --- Synthetic input ----------------------------------------------------

    /**
     * Synthesize a right-click on the slot to build the context menu (captured by
     * our hook), then synth-click the captured Drop row one frame later.
     */
    private async runSyntheticFlow(slotEl: HTMLElement): Promise<void> {
        this.inSyntheticFlow = true;
        this.capturedContainer = null;

        try {
            this.synthesizePointer(slotEl, MOUSE_RIGHT);
            await new Promise((resolve) => requestAnimationFrame(resolve));

            // No match means the item has no Drop action — let the click fall away.
            const container = this.capturedContainer;
            if (!container) return;

            this.synthesizePointer(container, MOUSE_LEFT);
        } finally {
            // Clear once the synthetic events have settled, not mid-flow.
            queueMicrotask(() => {
                this.inSyntheticFlow = false;
                this.capturedContainer = null;
            });
        }
    }

    /** Dispatch a pointerdown/pointerup pair at the center of the element. */
    private synthesizePointer(
        el: HTMLElement,
        button: typeof MOUSE_LEFT | typeof MOUSE_RIGHT
    ): void {
        const rect = el.getBoundingClientRect();
        const common = {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true,
            pointerType: "mouse",
            isPrimary: true,
        };
        const buttonsDown = button === MOUSE_LEFT ? 1 : 2;
        el.dispatchEvent(new PointerEvent("pointerdown", { ...common, button, buttons: buttonsDown }));
        el.dispatchEvent(new PointerEvent("pointerup", { ...common, button, buttons: 0 }));
    }
}
