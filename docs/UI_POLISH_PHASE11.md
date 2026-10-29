# Stage 24 / 第十一组：项目答辩 PPT 展示、逐页体检、自我陈述

## 范围与设计决定

- **保留 Stage 10 PPTX→DOCX→Chroma**：此路径继续用于中文 Embedding 与 RAG，不改变资料表/会话表字段，不迁移 SQLite。
- **新上传的 PPTX 同时保存原件**：DOCX 衍生资料仍以 `materials/<id>.docx` 存储；原件以 `materials/<id>.pptx` 保存在相同账号的 `uploads` 文件夹。上传完成以已有 DOCX 索引返回的 `material_id` 为准。原件写入失败则撤销新导入的材料，不报告成功。
- **本机幻灯片展示**：`我的材料` 页面及答辩模式会话页均可在页面内翻页、跳页、放大。页面内容只从当前账号本地目录读取；客户端不接受任意文件系统路径。
- **真实排版展示的前提**：本机 PowerPoint（Windows COM）或 LibreOffice 把原始 PPTX 转为本地 PDF，随后使用已安装的 PyMuPDF 生成 PNG。第一次显示可能较慢，转换结果保存在对应账号的 `uploads/presentations_cache`；展示不是 PPT 原版动画/过渡/嵌入视频播放器。
- **安全降级**：没有转换器或转换失败，自动展示可选中文字；原来只保存 DOCX 的 Stage 10 PPTX 也能提取按页文字，但**无法恢复旧版图片、版式**。想要完整幻灯片请重新上传原始 PPTX。
- **逐页 AI 体检是显式操作**：点击具体页的“AI 体检本页”，只发送此页提取的文字给当前配置的 DeepSeek / Ollama，返回可能追问、风险及补充建议；成功缓存到当前账号 `uploads/presentation_reviews`，重复进入不会再次付费。**不使用视觉模型，不能识别图表、截图、照片或图片中的文字**。
- **自我陈述**：答辩模式第一题尚未回答时可进行 5–8 分钟计时练习，支持文本输入和分段本地录音（每段最多约 105 秒，沿用 `/api/speech/transcribe`）；点击生成分析后执行**一次**模型 JSON 调用，并将尚未回答的第一题替换为针对陈述的追问。保存在已有 `config_data` JSON 字段，结果会缓存，重复请求不再调用 AI；后续生成问题可参考陈述的部分文字。
- **不需要语音也能演示**：麦克风存在输入音量过小或 PyAV 版本问题时，可以先自行口述并手动输入/粘贴自我陈述。答题文字区与陈述区独立；旧语音 Portal 明确挂在 `#current-answer`，不再误认陈述输入框。
- **计时提示**：已有每题/整场计时机制继续按 Stage 17 设置运行，陈述计时是单独的练习表计；需要完整 5–8 分钟陈述的场景，创建答辩时建议设置较长时间或单题不限时，避免正常答题倒计时先触发。

## 新增接口

- `GET /api/materials/{id}/slides`：当前账号的 PPT 页码、提取文字、原件状态、是否支持本地渲染；不调用模型。
- `GET /api/materials/{id}/slides/{page}/image`：本地 PPTX→PDF→PNG，返回对应页的图片；转换失败返回 422，前端降级文字。
- `POST /api/materials/{id}/slides/{page}/review`：明确用户动作触发 AI，按账号/资料/页缓存；不包含图片。
- `GET /api/interviews/{id}/opening`：当前账号已保存的自我陈述分析状态；不调用模型。
- `POST /api/interviews/{id}/opening`：只限正在进行的答辩模式、首次回答前、30–10000 字。缓存后不重复收费；条件更新避免覆盖已经提交的题目。

Stage 8B 登录和 Stage 8C2 资源权限检查仍负责新子路径。请求中不允许客户端提供任何本地文件绝对路径。

## 模型费用、隐私与数据

展示/翻页/查询缓存不产生 AI 调用。逐页 AI 体检和陈述分析按需触发，会把所选**文字**发到 `.env` 配置的模型服务；若使用 DeepSeek 云端，可能产生费用。原始 PPTX/PDF/PNG 不上传至 DeepSeek，API Key 不包含在补丁中。

原始 PPTX（含个人演示信息）以及本地生成的图片均是运行数据，应保留在用户私有 `storage` 中；不要提交 GitHub。删除资料会清理原件、演示缓存以及分析缓存。

## 安装与回退

1. 必须先安装 Stage 23 第十组；关闭 FastAPI 与 Vite。
2. 先运行 `install-group11.ps1 -ProjectRoot 'C:\Users\Kirino\Desktop\interview_system' -DryRun`；成功后再不带 `-DryRun` 运行。
3. 安装器先校验 payload SHA-256，针对本地非冲突代码差异做离线三方合并，失败不强制覆盖。正式安装前备份改动文件到 `_patch_backups/group11_presentation_时间戳`。
4. 在 `backend` 执行 `python -m pytest -q tests/test_group11_local_presentation.py tests/test_group10_practice_modes.py tests/test_group9_training_loop.py tests/test_ai_review_group8.py tests/test_resume_corrections_group2.py tests/test_document_preview_group3.py tests/test_dashboard_score_history_group6.py`。
5. 在 `frontend` 执行 `npm.cmd run test:ui` 和 `npm.cmd run build`。
6. 如需回退代码，先关闭服务，从本次备份还原更改前文件；运行期间用户新上传的 PPTX 不要直接删除。缓存可重新生成。

## 手工验收

- 选一份**新上传**的、文字可选中的 PPTX（建议 3–6 页），在“我的材料”打开“本地幻灯片展示”，翻页/跳页。
- 创建答辩模式并选择该资料。进入会话，边看幻灯片边回答，检查计时与原有单一回答框不变。
- 如有 PowerPoint/LibreOffice，首次渲染后能看到图片/图表/版式；否则提示文字模式。重新打开该 PPT，缓存图片应无需再次转换。
- 点击某一页“AI 体检本页”检查结果；第二次相同请求从本地缓存读出。
- 开始自我陈述计时，输入至少 30 字，点击生成，检查首题变成针对陈述的追问、刷新后分析存在。
- 继续答题并完成复盘；确认第九组的再练、登录和其他材料上传功能正常。
- 删除这份资料，检查同账户下对应原件和缓存已清理。

## 已知限制与待改进

- 原 PPT 逐页图片会由本地 Office/LibreOffice 渲染，**不提供 PowerPoint 特效、动画、嵌入视频的交互播放**。
- 视觉图表的语义识别尚未实现；逐页 AI 分析只依据文字，不能可靠评价图表里的数值或柱状图形状。
- 本地 Whisper 仍可能因设备、PyAV、麦克风问题失败；本组不修复驱动。文字陈述可替代。
- 自我陈述计时不是独立暂停已有答题倒计时的机制；需要完整陈述时先合理设置答辩计时。
- 多进程同时写相同 PPT 渲染缓存尚未做跨进程锁；建议保持本地单 Uvicorn 进程。AI 复盘/逐页分析在同一进程中有锁和缓存。
