# 第四组：答辩配置体验优化（Stage 17）

## 范围与设计（2026-10-27）

本组实现《系统优化方案》的第 **11、13 项**；不实现第 3、17、19、20 项的大模型后续改造，也不调用新的 AI API。

1. 在“开始答辩”页直接显示“5. 答辩时间设置”，统一管理评委风格、初始难度、自适应、主问题数、最多追问数、单题时间和整场时间。
2. 实时估算主问题所需时长：`question_count * questionMinutes`。若整场时间不足，醒目提示；如果刚好够主问题或可能不够追问，提示“时间较紧”；设置 0 代表不限时，不能推断实际时长。**这是参考提醒，不是必须按单题上限作答的硬性约束。** 输入不合法的配置不可创建答辩。
3. 三个预设（均在现有后端 3–30 主问题、0–2 追问、0–60 分钟限制内）：
   - 5 分钟快速练：友好、难度 2、温和自适应、3 题、0 追问；每题 1 分钟，整场 5 分钟。
   - 15 分钟模拟：标准、难度 3、标准自适应、5 题、最多 1 追问；每题 2 分钟，整场 15 分钟。
   - 30 分钟压力练：压力、难度 4、积极自适应、8 题、最多 2 追问；每题 3 分钟，整场 30 分钟。
4. 账号配置记忆通过现有的已登录接口 `GET /api/auth/profile` 获取 **服务端用户 UUID**；按 UUID 隔离浏览器 localStorage，并在登录/退出时重新核对当前账户（不传播用户信息）。保存配置与时长，不保存简历/材料 ID。无法读取存储时使用默认设置，不向其他账号复用旧的全局计时偏好键。
5. 创建会话成功后才写入现有 `stage9c:minutes:<sessionId>` 和 `stage9d:total-minutes:<sessionId>`；原有 `stage9:deadline:` 和 `stage9d:total-deadline:` 保持不变。已有答辩会话维持原有计时状态。无数据库变更、无 API 合约变更。
6. 移除原先由倒计时组件通过轮询 DOM 动态插入配置区的旧 Portal 及废弃 CSS；倒计时、语音答题和超时处理逻辑仍留在 `DefenseVoiceTimer.tsx`。

## 主要改动

- `frontend/src/components/auth/AuthGate.tsx`：登录、登出时发出无敏感信息的账号状态变更事件。
- `frontend/src/pages/InterviewConfigPage.tsx`：设置集中管理、账号偏好加载/保存、预设选择、预计时长提示和新会话计时绑定。
- `frontend/src/lib/defenseConfiguration.ts`：配置校验、预设、账号隔离的本地持久化、时间估算与会话计时绑定纯函数。
- `frontend/src/components/speech/DefenseVoiceTimer.tsx`：移除配置页 DOM Portal，保留所有会话计时及语音代码。
- `frontend/src/components/speech/speechTimer.css`：清理过时的配置区样式，保留会话计时显示样式。
- `frontend/tests/defense-config-group4.test.mjs`：边界、预设、数据隔离、损坏存储、旧会话保护、集成结构回归。
- `frontend/package.json`、`frontend/README.md`：前端测试环境与使用说明更新。

## 安装与验收

先确保前三组已安装，特别是第三组 `docs/UI_POLISH_PHASE3.md` 和 `frontend/src/components/DocumentPreview.tsx`。关闭运行中的 Vite、FastAPI，使用 ZIP 中的 `install-group4.ps1 -DryRun` 确认基线匹配或离线无冲突合并；正式安装前会对原文件执行 SHA-256 完整性校验和本地备份。

项目根目录 `C:\Users\Kirino\Desktop\interview_system`：

```powershell
$project = 'C:\Users\Kirino\Desktop\interview_system'
Set-Location (Join-Path $project 'frontend')
npm.cmd ci
npm.cmd run test:ui
npm.cmd run build
```

浏览器验收：

1. 用 A 账号进入“开始答辩”，切换三个预设，确认难度、题量、追问、时间一起改变。
2. 主问题数设 10，单题 2 分钟，整场 6 分钟，确认出现总时长不足提示；单题或整场设 0，确认不限时描述。输入 61、负数、空字符串时不能创建。
3. 设置独立参数，离开再进入/刷新页面，应恢复 A 账号上次设置。
4. 登出换 B 账号，应该使用 B 账号自己的设置或默认值；切回 A 账号能恢复 A 的设置。
5. 用已有简历创建**新会话**，确认倒计时显示所选单题/整场时间；返回已有历史会话，旧计时不应改变。
6. 验证账号登录、简历编辑、文件预览与答辩提交仍正常。

## 兼容性和已知限制

- `localStorage` 为浏览器本地存储，删除浏览器数据或换电脑不会同步配置；本组不写入 SQLite。
- 禁用本地存储的浏览器无法可靠地保留自选倒计时设置；旧计时组件按照原有默认规则回退。
- 预估只反映“每题时间上限”与题量，实际练习时长受答题、追问和模型响应影响。若希望更短的总时间，提示会出现但不强制拦截。
- 文件差异很可能来自独立开发或 Windows CRLF 换行。本补丁在可证明无冲突时合并，遇到同一代码段的重叠变更不会强制覆盖。
- 测试状态以实际日志为准；静态/Node 测试通过不代表本机已完成 Vite 全量构建。安装后务必运行 `npm.cmd run build`。
