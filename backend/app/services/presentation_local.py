"""Account-local PPTX slide navigator. PPTX is not sent to a third party.

The existing DOCX derivative remains the RAG source of truth. A native PPTX
copy is stored beside it under the same UUID. Converting for display uses only
local PowerPoint / LibreOffice, with a selectable-text fallback for old uploads.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
import os
import re
import shutil
import subprocess
import tempfile
from uuid import UUID

from docx import Document

MAX_FILE_BYTES = 12 * 1024 * 1024


class PresentationError(ValueError):
    pass


def original_path(upload_dir: Path, material_id: str) -> Path:
    # Fail closed for arbitrary paths, even when a caller bypasses the API.
    canonical = str(UUID(material_id))
    if canonical != material_id:
        raise PresentationError('无效的资料编号')
    return upload_dir / 'materials' / (canonical + '.pptx')


def slide_texts(upload_dir: Path, material) -> tuple[list[dict], bool]:
    original = original_path(upload_dir, material.id)
    if original.is_file():
        if original.stat().st_size > MAX_FILE_BYTES:
            raise PresentationError('PPTX 文件超过上传大小限制')
        from app.stage10_pptx import extract_pptx_pages
        pages = extract_pptx_pages(original.read_bytes())
        return ([{'index': i, 'text': '\n'.join(paragraphs)[:16000]}
                 for i, paragraphs in pages], True)
    # Old Stage 10 imports kept only a DOCX with page headings.
    if not material.original_filename.endswith('_PPTX文字提取版.docx'):
        return [], False
    saved = upload_dir / 'materials' / material.stored_filename
    if not saved.is_file():
        return [], False
    try:
        document = Document(BytesIO(saved.read_bytes()))
        pages: list[dict] = []
        for paragraph in document.paragraphs:
            match = re.fullmatch(r'第\s*(\d+)\s*页(?:\s*[:：—-]\s*.*)?', paragraph.text.strip())
            if match:
                if len(pages) >= 150:
                    raise PresentationError('页数超过 150')
                pages.append({'index': len(pages) + 1, 'text': ''})
            elif pages:
                pages[-1]['text'] = (pages[-1]['text'] + '\n' + paragraph.text).strip()[:16000]
        return pages, False
    except Exception as exc:
        if isinstance(exc, PresentationError):
            raise
        raise PresentationError('旧 PPTX 的文字资料无法读取') from exc


def _find_libreoffice() -> str | None:
    located = shutil.which('soffice') or shutil.which('libreoffice')
    if located:
        return located
    if os.name == 'nt':
        for env in ('PROGRAMFILES', 'PROGRAMFILES(X86)'):
            prefix = os.environ.get(env)
            if prefix:
                path = Path(prefix) / 'LibreOffice' / 'program' / 'soffice.exe'
                if path.is_file():
                    return str(path)
    return None


def _powerpoint_installed() -> bool:
    """Check the registered COM application, not merely the PowerShell executable.

    PowerShell is installed on almost all Windows machines, even when Office is not.
    The old check incorrectly enabled a slow image render for every slide.
    """
    if os.name != 'nt':
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r'PowerPoint.Application\CLSID') as key:
            clsid, _ = winreg.QueryValueEx(key, '')
            return bool(str(clsid).strip())
    except (ImportError, OSError, ValueError):
        return False


def conversion_available() -> bool:
    return bool(_find_libreoffice() or _powerpoint_installed())


def _render_pdf(source: Path, pdf_target: Path) -> None:
    """Local-only conversion; PowerPoint COM is an optional Windows fallback."""
    with tempfile.TemporaryDirectory(prefix='pptx_render_') as directory:
        work = Path(directory)
        candidate = work / (source.stem + '.pdf')
        libreoffice = _find_libreoffice()
        if libreoffice:
            try:
                process = subprocess.run(
                    [libreoffice, '-env:UserInstallation=file:///' + work.as_posix().lstrip('/'),
                     '--headless', '--convert-to', 'pdf', '--outdir', str(work), str(source)],
                    capture_output=True, timeout=75, check=False,
                )
                if process.returncode == 0 and candidate.is_file():
                    shutil.copyfile(candidate, pdf_target)
                    return
            except (OSError, subprocess.TimeoutExpired):
                pass
        if os.name == 'nt':
            powershell = shutil.which('powershell.exe') or shutil.which('pwsh.exe')
            if powershell:
                script = work / 'export.ps1'
                script.write_text('''param([string]$InputPptx,[string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$app = $null
$ppt = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $ppt = $app.Presentations.Open($InputPptx, $true, $false, $false)
  $ppt.SaveAs($OutputPdf, 32)
} finally {
  if ($ppt) { $ppt.Close() }
  # Leave the user's PowerPoint process running; never close their other decks.
}
''', encoding='utf-8-sig')
                try:
                    process = subprocess.run(
                        [powershell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                         str(script), str(source), str(candidate)],
                        capture_output=True, timeout=75, check=False,
                    )
                    if process.returncode == 0 and candidate.is_file():
                        shutil.copyfile(candidate, pdf_target)
                        return
                except (OSError, subprocess.TimeoutExpired):
                    pass
    raise PresentationError('未能在本机渲染 PPT。可安装 LibreOffice 或使用 PowerPoint；文字翻页仍可用。')


def render_png(upload_dir: Path, material_id: str, page: int, page_count: int) -> bytes:
    if not 1 <= page <= page_count <= 150:
        raise PresentationError('幻灯片页码超出范围')
    pptx = original_path(upload_dir, material_id)
    if not pptx.is_file():
        raise PresentationError('原始 PPTX 不存在，只能显示文字提取版')
    cache = upload_dir / 'presentations_cache'
    cache.mkdir(parents=True, exist_ok=True)
    pdf = cache / (material_id + '.pdf')
    image = cache / (material_id + '_' + str(page) + '.png')
    if image.is_file():
        return image.read_bytes()
    if not pdf.is_file():
        with tempfile.NamedTemporaryFile(suffix='.pdf', dir=cache, delete=False) as tmp:
            temporary = Path(tmp.name)
        try:
            _render_pdf(pptx, temporary)
            os.replace(temporary, pdf)
        finally:
            temporary.unlink(missing_ok=True)
    import fitz  # PyMuPDF is an existing backend dependency.
    with fitz.open(pdf) as document:
        if page > document.page_count:
            raise PresentationError('渲染结果缺少对应幻灯片')
        pixmap = document[page - 1].get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False)
        raw = pixmap.tobytes('png')
    # Atomic cache file write; no direct file path is exposed to the browser.
    with tempfile.NamedTemporaryFile(suffix='.png', dir=cache, delete=False) as tmp:
        temporary = Path(tmp.name)
        tmp.write(raw)
    os.replace(temporary, image)
    return raw


def remove_presentation_files(upload_dir: Path, material_id: str):
    original_path(upload_dir, material_id).unlink(missing_ok=True)
    cache = upload_dir / 'presentations_cache'
    for path in cache.glob(material_id + '_*.png') if cache.is_dir() else []:
        path.unlink(missing_ok=True)
    (cache / (material_id + '.pdf')).unlink(missing_ok=True)
