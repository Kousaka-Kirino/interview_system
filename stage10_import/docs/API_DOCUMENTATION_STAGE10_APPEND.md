<!-- STAGE10_PPTX_BEGIN -->
## Stage 10 — PPTX 资料兼容上传接口

| Method | Path | 登录 | 说明 |
|---|---|---|---|
| POST | `/api/materials/pptx-import` | 必须 | 上传 `.pptx` 并转换为 DOCX 文字副本，再进入既有资料索引流程 |

- Content-Type：`multipart/form-data`，字段名 `file`；支持 `.pptx`，大小至多 12 MiB，至多 150 张幻灯片及 200,000 个可提取文字字符。
- 旧格式 `.ppt` 不支持；空白/全图片型 PPTX 不能提取有效文字，返回 422。
- 成功时返回与既有 `POST /api/materials` 相同的 `MaterialInfo`，状态为 201；`original_filename` 将显示**生成的文字版 `.docx` 文件名**，以避免误认为原始 PPTX 已原样保存。
- 典型失败：401 未登录；413 文件过大；415 格式不受支持；422 文件损坏或不含可提取文字；原资料上传服务的其他错误码会原样返回。
- 原有 `GET /api/materials`、`POST /api/materials/search`、`DELETE /api/materials/{material_id}` 无契约改动；仍使用材料 ID 检索与删除。
- 文本页码以“第 N 页”标题写入转换文本。检索结果的 `chunk_index` 是文本分块编号，**不能直接当作幻灯片页码**。
- 导入过程中仅处理文字，不解析图片和图表，不存储原始 PPTX 文件；转换过程只在请求期间占用内存。
<!-- STAGE10_PPTX_END -->
