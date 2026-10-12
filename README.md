# Quick Drop

A Highspell+ plugin that lets you drop an inventory item with a single click, skipping the right-click context menu.

## What it does

Pick how you want to drop in the plugin settings, then that gesture drops the item directly. For stackable items it drops the **whole stack** — never the "Drop X" quantity prompt.

The **Drop with** setting has three options:

| Option | Gesture |
|---|---|
| **Left click** | plain left click |
| **Right click** | plain right click (replaces the normal context menu) |
| **Shift+Left click** | shift + left click |

The plugin only acts when the click lands on a normal inventory slot and the bank is **not** open (with the bank open, an inventory click means deposit — that's left to the game / [Quick Deposit](https://github.com/matter418/QuickDeposit)). If the clicked item has no Drop action, nothing happens and the click falls through.

## Installation

The intended way to install is through the Highspell+ plugin hub. Open Highspell+, go to the plugins menu, find **Quick Drop**, and enable it.

## Building from source

```bash
git clone https://github.com/matter418/QuickDrop.git
cd QuickDrop
yarn install
yarn build
```

The bundled output ends up at `dist/QuickDrop.js`. To test it locally against a development copy of Highspell+, copy that file into the client's `src/renderer/client/plugins/` and launch the client.

## How it works (briefly)

The plugin watches every click on the page. When one matches your configured trigger on an inventory slot, the plugin:

1. Suppresses the default click.
2. Synthesizes a right-click on the same slot to make the game build its context menu.
3. Reads the menu items via a registered context-menu hook, finds the **Drop** row (inventory action id `2`, the no-prompt drop), and synthesizes a click on that item's container.
4. Cleans up. The whole sequence happens within a single animation frame and isn't visible during normal play.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
