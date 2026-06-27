// Shared frame interval for render throttling and animations (~60fps)
// Increased to 50ms (~20fps) for better compatibility with legacy Windows terminals
// like cmder on Windows 7 and IDE integrated terminals, which may exhibit display
// corruption, content duplication, and text stacking at higher frame rates
export const FRAME_INTERVAL_MS = process.platform === 'win32' && !process.env.WT_SESSION ? 50 : 16
