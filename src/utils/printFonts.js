/**
 * Shared font settings for every printed document (menus, weekly sheets,
 * kitchen tickets, inventory, service breakdown).
 *
 * Inkjet ink spreads on paper and makes strokes print noticeably heavier
 * than on screen, so print uses lighter Roboto Mono weights than the UI:
 * Light (300) for body text and Medium (500) where we'd normally use bold.
 * Tweak these two numbers to go lighter/heavier; the font link below loads
 * exactly these weights so the browser never synthesizes a faux bold.
 */
export const PRINT_WEIGHT_REGULAR = 300;
export const PRINT_WEIGHT_BOLD = 500;

export const PRINT_FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@${PRINT_WEIGHT_REGULAR};${PRINT_WEIGHT_BOLD}&display=swap" rel="stylesheet">`;
