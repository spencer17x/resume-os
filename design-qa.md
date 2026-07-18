# Design QA — Resume OS Cinematic AI Desktop V2

## 验收基线

- 视觉参考：`docs/design/references/resume-os-cinematic-ai-desktop-v2.png`
- 同画幅参考对照：`docs/design/qa/reference-vs-implementation-1440x1024.jpg`
- 本次 PC 问题匿名化页面截图：`docs/design/qa/reported-pc-ui-issue.png`
- 同视口修复前后：`docs/design/qa/pc-issue-before-vs-after-1440x634.jpg`
- 最终实现截图：
  - `docs/design/qa/implementation-1440x1024.jpg`
  - `docs/design/qa/implementation-1440x900.jpg`
  - `docs/design/qa/implementation-1440x691-pc-fixed.jpg`
  - `docs/design/qa/implementation-1440x634-pc-fixed.jpg`
  - `docs/design/qa/implementation-1280x720.jpg`
  - `docs/design/qa/implementation-390x844.jpg`
  - `docs/design/qa/reduced-motion-poster-1440x1024.jpg`
- 参考图状态：`/zh`、深色主题、完整动态效果、无应用窗口打开。
- PC 回归状态：`/zh`、浅色应用主题、系统动态模式、无应用窗口打开。

## 同画幅视觉对比

参考图与最终实现已放入同一个 `1440 × 1024` 对比输入并完成目视复核。

- Stage：参考与实现均为约 `(232, 89, 1120, 757)`。
- Agent Core：实现 host 约 `(746, 369, 92, 92)`，中心 `(792, 415)`，与参考一致。
- 顶部启动器：实现 `(23, 53, 790, 80)`，共 9 项，顺序与参考一致。
- Phase rail：实现约 `(450, 725, 683, 87)`，四阶段位置与参考一致。
- Dock panel：实现 `(566, 952, 309, 62)`，共 6 项；参考约 `(567, 952, 307, 62)`。
- HUD：实现 `(24, 150, 300, 88)`，位于左侧安全区，与启动器和 Agent 节点无交集。
- 结论：核心构图、节点层级、系统栏与 Dock 已对齐视觉基线；无未解决 P0、P1 或 P2 视觉问题。

## 本次 PC 回归修复

同视口 `1440 × 634` 修复前后已合并到一张对比图中复核。

- 修复前：Launcher 被错误隐藏，Dock 展开为 10 项；浅色菜单栏、Dock 与壁纸底座包围深色 Agent 舞台；Stage 约 `(367, -7, 850, 574)`，阶段栏下缘越过桌面内容区。
- 修复后：Launcher 为 `(12, 36, 536, 68)` 且 9 项全部可见；Dock 为 `(566, 562, 309, 62)` 且只保留 6 个常用入口。
- 修复后 Stage 为 `(486, 94, 613, 414)`，Phase rail 为 `(605, 442, 374, 87)`，两者均完整落在桌面内容区内。
- 紧凑 HUD 移至右上安全区 `(1146, 36, 282, 68)`，折叠易重叠的阶段圆点，仅保留工作流说明和主 CTA。
- 桌面壁纸、菜单栏、Launcher 与 Dock 固定使用 Cinematic Dark 系统外壳；应用窗口仍独立继承用户选择的浅色主题。
- 顶部语言按钮的 Tailwind 色彩别名已在系统外壳局部重置，不再出现亮白胶囊。

## 响应式与访问能力

- `1440 × 900`：完整构图；9 项 Launcher、6 项 Dock；Stage、Phase rail 和所有 Agent 目标均在安全区内。
- `1440 × 800 / 691 / 634`：紧凑 PC 构图；Launcher 与 HUD 同处顶部安全行，无交集；舞台按剩余高度缩放。
- `1280 × 720`、`1024 × 768`、`900 × 768`：仍保留 9 项 Launcher 和 6 项 Dock，不因浏览器可用高度较低而丢失入口。
- `899 × 768`：进入窄桌面模式，Launcher 隐藏，Dock 展开为完整 10 项，所有应用仍可直接启动。
- 所有已验收尺寸均无文档横向/纵向溢出；Stage、Phase rail、Dock 均在视口内；Launcher 不与 HUD 或 Agent 目标相交。

## Agent 叙事与动效

- 共享周期：`14000ms`。
- 叙事顺序：`Evidence → Target JD → Retrieve → Rank → Synthesize → Verify → Resume Variant`。
- 六个 Agent 节点、Core、数据线路、数据包、阶段轨与最终 Variant 共用叙事时钟。
- 全部视觉由现有图标与 DOM/CSS 元素实现；场景和页面均不含 `video`、`canvas` 或 `img`。
- Reduced Motion 使用 poster 状态：数据包隐藏、完成态与 Variant 保持可见、运行中场景动画为 0。

## Chrome 实机验收

- 用户实际 Chrome 自然视口 `1440 × 634`：通过。
- `1440 × 691`、`1440 × 800`、`1440 × 899`、`1440 × 900`、`1440 × 925`、`1440 × 926`、`1440 × 1024`：通过。
- `1280 × 720`、`1024 × 768`、`900 × 768`、`899 × 768`：通过。
- 浅色主题下：菜单栏、壁纸与 Dock 保持深色；打开的简历工作室窗口为白色，主题作用域没有泄漏。
- 900px 断点显示 9 项 Launcher / 6 项 Dock；899px 断点显示完整 10 项 Dock。
- 顶部启动器双击打开简历工作室、窗口关闭与桌面状态恢复：通过。

## 自动化与构建门禁

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：59 个测试文件、743 个测试全部通过。
- `pnpm build`：生产构建通过。
- E2E 契约已加入 1440×800/691/634、1024×768、899/900 边界、Launcher/Agent 碰撞、浅色应用主题与深色系统外壳隔离断言。
- 遵循用户指定的 Chrome 验收方式，未另行启动 Playwright 浏览器。
- `git diff --check`：通过。

final result: passed
