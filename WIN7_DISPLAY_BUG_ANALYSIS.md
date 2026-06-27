# Win7 终端显示错乱/重叠/卡死 问题分析

https://github.com/Ghost2391/claude-code-win7.git

## 现象

Windows 7 (cmd/ConEmu/cmder) 下 Claude Code 终端显示错乱。Win10 完全正常。

### 原始问题（main 分支）
1. **内容重叠**：不同行文字渲染到同一行（`Accessing woWelcome back!`）
2. **ASCII art 错位**：LogoV2 的 `▐▛███▜▌` 字符画与路径文字重叠
3. **双栏布局断裂**：左右栏内容互相侵入
4. **ESC 退出插件设置后欢迎页堆叠并卡死**
5. **libuv 崩溃**：`Assertion failed: new_time >= loop->time`（Node 18.20.8 on Win7，stdout 写入过频触发）

---

## 根本原因

Win7 conhost **没有 alt screen 缓冲**（DEC 1049 是 no-op）。主屏幕是**累积型**的——内容写入后自然向下滚动，无法原地覆盖。

Ink 的渲染模型依赖 alt screen：
- 固定大小的屏幕缓冲区
- `CURSOR_HOME` 归位后原地重绘
- diff 引擎只输出变化的 cell

主屏幕上这些全部失效：`ENTER_ALT_SCREEN` 是空操作，`CURSOR_HOME` 后写入会导致滚动而非覆盖。

### 附带问题：光标定位序列漂移

Win7 conhost 处理 CSI A/B/C/D（相对光标移动）时在视口边界附近会漂移：
- `cursorUp` (CSI A) — 接近顶部时可能不移动或跳到 scrollback
- `cursorForward` (CSI C) — 接近右边界时可能换行
- `cursorDown` (CSI B) — 接近底部时可能滚动视口

代码中受影响的路径：
- `log-update.ts` `moveCursorTo()` — 同行移动使用 `cursorForward` / `cursorBack`
- `log-update.ts` `eraseLines()` — 使用 `cursorUp` 逐行上移
- `log-update.ts` `renderFrameSlice()` — 行内定位使用 `moveCursorTo`

---

## 尝试过的所有修复方案

### 1. `resetScreen` 强制全量 diff + CURSOR_HOME（main 分支已有）

**分支**: main
**改动**: `ink.tsx` — `resetScreen(prevFrame.screen)` 清空上一帧缓冲 → diff 输出所有 cell；clear preamble 加 `CURSOR_HOME_PATCH`
**结果**: ❌ 每帧 ~100KB 输出，Win7 conhost 处理不过来 → 帧间交错 → 错乱更严重 → libuv 崩溃

### 2. 全帧 `renderFrameSlice`（forceFullReset）

**分支**: win7-fullreset-fix
**改动**: `log-update.ts` — Win7 上每帧用 `CURSOR_HOME + renderFrame(\r\n) + ERASE_BELOW` 替代 diff
**结果**: ❌ 主屏幕无限刷新/滚动（每帧清屏+写内容→推到底部→下一帧又归位重来）

### 3. CURSOR_HOME 锚定光标 + 增量 diff

**分支**: win7-cursor-anchor-fix
**改动**: `ink.tsx` — `needsCursorAnchor` 和 `needsClearPreamble` 扩展至 Win7，每帧 prepend `CURSOR_HOME_PATCH`
**结果**: ❌ 主屏幕无限向下滚动（`\x1b[H` 把光标拉到 (0,0)，内容写完后光标在底部，下帧又拉回，循环推内容）

### 4. 绝对 CUP 替代所有相对光标移动（方案 D）

**分支**: win7显示重复问题-d09df (56bcbed7)
**改动**:
- `log-update.ts` `moveCursorTo()` — 同行移动也走绝对 CUP（`cursorPosition`）
- `constants.ts` — 帧率 32→50ms (20fps)
**结果**: ✅ 不卡死不崩溃，首屏正常，稳态正常
**遗留**: ❌ 视图切换时旧内容堆叠（打开 /plugin、切换 tab、ESC 退出后上一屏内容不消失）

### 5. 方案 D + layout-shift 时清屏

**分支**: win7显示重复问题-d09df (后续 commit)
**改动**: `ink.tsx` — `didLayoutShift()` 捕获结果；Win7 main screen 在 layout-shift 时 prepend `HOME_THEN_ERASE_BELOW_PATCH` 或 `ERASE_THEN_HOME_PATCH`
**结果**: ❌ 启动即 libuv 崩溃（连续多帧 layout-shift 触发多次清屏 → 输出爆炸）

### 6. 方案 D + layout-shift 清屏 + 冷却

**分支**: win7显示重复问题-d09df（加 cooldown）
**改动**: 同上 + 60 帧冷却间隔
**结果**: ❌ 仍然崩溃（冷却不够或根本问题不在频率而在单次输出大小）

### 7. 方案 D + CURSOR_HOME 每帧（仅清 premble）

**分支**: win7显示重复问题-d09df (c2c45316)
**改动**: `ink.tsx` — `needsClearPreamble` 扩展至 Win7，Win7 main screen 每帧 prepend `CURSOR_HOME_PATCH`（不擦除）
**结果**: ❌ 仍然堆叠（`\x1b[H` 在主屏幕上不擦除旧内容，diff 覆盖不完整）

### 8. 方案 D + layout-shift 时 ERASE_SCREEN，稳态 CURSOR_HOME

**分支**: win7显示重复问题-d09df (a0898877)
**改动**: `ink.tsx` — Win7 main screen：`layoutShift` 时 `ERASE_THEN_HOME_PATCH`，稳态 `CURSOR_HOME_PATCH`
**结果**: ❌ 仍不行

### 9. ConEmu 排除 legacy + 启用 fullscreen

**分支**: main（直接改 terminal.ts）
**改动**: `terminal.ts` `isLegacyWindowsConsole()` — ConEmu (`ConEmuANSI`/`ConEmuPID`) 返回 false，不再算 legacy。配合 `CLAUDE_CODE_NO_FLICKER=1` 启用 fullscreen
**结果**: ❌ 还是一样（ConEmu 即使有 alt screen，配合 Win7 + Node 18 整体链路仍有问题）

### 10. 最小改动：仅 log-update.ts 两处修复

**分支**: win7-minimal-fix
**改动**: 
- `log-update.ts` `moveCursorTo()` — 同行也走绝对 CUP
- `log-update.ts` `render()` — win32 上 shrinking 走 fullReset（绕过 `eraseLines` 的 CSI A 漂移）
**结果**: ❌ 未充分测试（用户决定放弃此方向）

### 11. Git Bash (mintty)

**尝试**: 在 Win7 上使用 Git Bash 的 mintty 终端（理论上支持完整 ANSI 和 DEC 1049）
**结果**: ❌ Node.js 在 mintty 下 `process.stdin.isTTY` 返回 false，进入 pipe 模式退出

---

## 失败的根因总结

| 方案类别 | 代表方案 | 失败原因 |
|----------|----------|----------|
| 主屏幕每帧归位 | 3, 7 | `\x1b[H` 在主屏幕上不擦除旧内容，只移光标；diff 覆盖不完整导致堆叠 |
| 主屏幕每帧擦除+重绘 | 1, 2 | 擦除造成闪烁或无限滚动；全量输出超 Win7 conhost 吞吐 |
| 仅切换帧擦除 | 5, 6, 8 | 启动时连续 layout-shift 触发多次清屏 → 输出爆炸 → libuv 崩溃 |
| 消除相对光标漂移 | 4, 10 | 解决了稳态问题但切换帧的旧内容清除仍依赖不完善的机制 |
| 换终端 | 9, 11 | ConEmu 整体链路仍不可靠；mintty 的 TTY 检测失败 |

**核心矛盾始终是同一个**：

```
Ink 的渲染模型（虚拟缓冲 + diff + alt screen）
        ↕ 不兼容
Win7 conhost（无 alt screen + 弱 ANSI + 慢处理）
```

任何在主屏幕上模拟"全屏重绘"的尝试都会遇到：
- 不擦除 → 旧内容残留
- 擦除（`\x1b[2J`）→ 主屏幕滚动
- 擦除（`\x1b[J`）→ 闪烁或事件循环卡死

---

## Win10 模拟 Win7 测试

```
set CLAUDE_CODE_FORCE_LEGACY_CONSOLE=1
claude.bat
```

此环境变量已内置在 `packages/@ant/ink/src/core/terminal.ts` 和 `clearTerminal.ts` 的 `isLegacyWindowsConsole()` 函数中。

---

## 附：libuv 崩溃

```
Assertion failed: new_time >= loop->time, file c:\ws\deps\uv\src\win\core.c, line 327
```

Node.js 18 在 Win7 上的已知 bug。大体积/高频 stdout 写入导致事件循环卡死，恢复后 timer 校验失败。**重启电脑可暂时恢复**（清空被污染的终端状态）。
