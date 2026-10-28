"""离线提取 PDF/DOCX 正文及标题分区，不调用 DeepSeek。"""

import io
import re
import zipfile
from pathlib import Path
from typing import Any

import fitz
from docx import Document

MAX_RESUME_TEXT_CHARS = 100_000
MAX_DOCX_UNCOMPRESSED = 50 * 1024 * 1024

SECTION_ALIASES = {
    "profile": ("基本信息", "个人信息", "个人简介", "个人概况", "个人资料", "profile", "summary"),
    "education": ("教育经历", "教育背景", "教育信息", "education"),
    "experience": ("工作经历", "实习经历", "工作经验", "实习经验", "实习", "社会实践", "employment", "experience", "internship"),
    "projects": ("项目经历", "项目经验", "项目实践", "项目介绍", "科研经历", "课题经历", "projects", "project experience"),
    "skills": ("专业技能", "技术技能", "个人技能", "技能清单", "技能", "skills", "technical skills"),
    "awards": ("获奖经历", "获奖情况", "所获荣誉", "荣誉奖项", "荣誉证书", "证书", "荣誉", "awards", "certifications"),
    "other": ("其他", "其他信息", "兴趣爱好", "补充信息", "other"),
}


def extract_resume_text(content: bytes, extension: str) -> str:
    """提取可选中的文本；图片扫描版 PDF 需要未来加入 OCR。"""
    if extension == ".pdf":
        if not content.startswith(b"%PDF-"):
            raise ValueError("文件内容不是有效的 PDF")
        try:
            with fitz.open(stream=content, filetype="pdf") as document:
                if document.page_count > 80:
                    raise ValueError("简历最多支持 80 页")
                text = "\n".join(page.get_text(sort=True) for page in document)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("PDF 无法解析，可能已损坏或已加密") from exc

    elif extension == ".docx":
        if not content.startswith(b"PK"):
            raise ValueError("文件内容不是有效的 DOCX")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                infos = archive.infolist()
                if len(infos) > 1000 or sum(i.file_size for i in infos) > MAX_DOCX_UNCOMPRESSED:
                    raise ValueError("DOCX 解压后体积过大，拒绝处理")
            document = Document(io.BytesIO(content))
            lines = [p.text for p in document.paragraphs]
            for table in document.tables:
                for row in table.rows:
                    lines.append(" | ".join(cell.text for cell in row.cells))
            text = "\n".join(lines)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("DOCX 无法解析，可能已损坏") from exc

    else:
        raise ValueError("只支持 PDF 和 DOCX 简历")

    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not normalized:
        raise ValueError("未提取到文字，请上传可复制文字的简历；扫描版暂不支持")
    if len(normalized) > MAX_RESUME_TEXT_CHARS:
        raise ValueError("简历文本超过 100000 字符，请精简后重新上传")
    return normalized


# 固定七个可维护章节；不把邮箱、姓名、电话当作额外章节计数。
SECTION_KEYS = ("profile", "education", "experience", "projects", "skills", "awards", "other")
SECTION_LABELS = {
    "profile": "基本信息", "education": "教育经历", "experience": "实习/工作经历",
    "projects": "项目经历", "skills": "专业技能", "awards": "获奖情况", "other": "其他",
}


def _section_title(line: str) -> tuple[str | None, str]:
    """匹配独立章节标题，以及“项目经历：某项目”这种单行标题+内容。"""
    candidate = re.sub(r"^[\s#*•·\-\d.、（）()]+", "", line).strip()
    compact = re.sub(r"[\s:：\-—|┃【】\[\]]", "", candidate).lower()
    for section, names in SECTION_ALIASES.items():
        for name in names:
            if compact == re.sub(r"\s", "", name).lower():
                return section, ""
            match = re.match(r"^" + re.escape(name) + r"\s*[:：]\s*(.+)$", candidate, re.I)
            if match:
                return section, match.group(1).strip()
    return None, ""


def parse_resume_sections(text: str) -> dict[str, Any]:
    """仅分区原文，不凭空补全；跨行标题、常见中文标题与同行正文都能识别。"""
    sections: dict[str, list[str]] = {key: [] for key in SECTION_KEYS}
    current = "profile"
    for line in text.splitlines():
        detected, inline_text = _section_title(line)
        if detected is not None:
            current = detected
            if inline_text:
                sections[current].append(inline_text)
            continue
        if line.strip():
            sections[current].append(line.strip())

    email_match = re.search(r"[\w.+\-]+@[\w.\-]+\.[A-Za-z]{2,}", text)
    phone_match = re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text)
    name_match = re.search(r"(?:姓名|Name)\s*[:：]\s*([^\s|,，]{2,30})", text, re.I)

    return {
        "name": name_match.group(1) if name_match else None,
        "email": email_match.group(0) if email_match else None,
        "phone": phone_match.group(0) if phone_match else None,
        "sections": sections,
        "extraction_method": "rule_based_v2",
    }


def resume_quality(data: dict[str, Any] | None) -> dict[str, Any]:
    """完整度只表示七个章节是否包含文本；不代表 AI 识别准确率。"""
    data = data if isinstance(data, dict) else {}
    raw = data.get("sections")
    raw = raw if isinstance(raw, dict) else {}
    missing = []
    for key in SECTION_KEYS:
        lines = raw.get(key)
        filled = isinstance(lines, list) and any(isinstance(v, str) and v.strip() for v in lines)
        if key == "profile" and not filled:
            filled = any(isinstance(data.get(k), str) and data[k].strip() for k in ("name", "email", "phone"))
        if not filled:
            missing.append(key)
    return {"filled": len(SECTION_KEYS) - len(missing), "total": len(SECTION_KEYS), "missing_sections": missing}


def resume_context(full_text: str, structured_data: dict[str, Any] | None) -> str:
    """用户修正的字段优先放在上下文开头，保留未改变的原文作为参考。"""
    data = structured_data if isinstance(structured_data, dict) else {}
    if not data.get("manual_reviewed"):
        return full_text
    rows = ["【用户核对并保存的简历信息（与原文冲突时以此为准）】"]
    for key, label in (("name", "姓名"), ("email", "邮箱"), ("phone", "电话")):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            rows.append(f"{label}：{value.strip()}")
    sections = data.get("sections")
    sections = sections if isinstance(sections, dict) else {}
    for key in SECTION_KEYS:
        lines = sections.get(key)
        if isinstance(lines, list):
            values = [v.strip() for v in lines if isinstance(v, str) and v.strip()]
            if values:
                rows.append(f"{SECTION_LABELS[key]}：" + "；".join(values))
    rows.append("【原始提取文本（仅供参考，可能包含解析错误）】")
    rows.append(full_text)
    return "\n".join(rows)
