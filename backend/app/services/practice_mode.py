"""Persistent practice modes; the existing SQLite session table stays unchanged."""
from app.models.resume import Resume

INTERNAL_FLAG = "_internal_defense_context"


def is_internal_resume(resume: Resume | None) -> bool:
    return bool(resume and isinstance(resume.structured_data, dict)
                and resume.structured_data.get(INTERNAL_FLAG) is True)


def practice_mode(config_data: dict | None) -> str:
    return "defense" if isinstance(config_data, dict) and config_data.get("practice_mode") == "defense" else "interview"


def project_context(filenames: list[str]) -> str:
    # File names are leads only. Model receives indexed excerpts as the real source.
    names = "、".join(name[:160] for name in filenames[:10])
    return ("项目答辩模式。围绕用户上传的项目材料、研究方法、实现细节、"
            "实验数据和结果的可验证性进行提问。"
            "切勿把文件名当作实验结论。资料名称：" + names)
