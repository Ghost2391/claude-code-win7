// Shared frame interval for render throttling and animations (~60fps)
// Increased to 32ms (~30fps) for better compatibility with legacy Windows terminals
// like cmder on Windows 7, which may exhibit display corruption at higher frame rates
export const FRAME_INTERVAL_MS = process.platform === 'win32' && !process.env.WT_SESSION ? 32 : 16
