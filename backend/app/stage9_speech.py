"""Stage 9 -- locally transcribe one bounded recording with faster-whisper.

No voice bytes are stored permanently. Authentication comes from Stage 8B/C.
The model is downloaded to the normal local Hugging Face cache on first use.
"""
from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.stage8b_auth import require_owner_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/speech", tags=["speech"])
MAX_FILE_BYTES = 18 * 1024 * 1024
MAX_AUDIO_SECONDS = 125.0
_ALLOWED_EXT = {"webm", "ogg", "mp4", "m4a", "wav", "mp3"}
_MODEL = None
_MODEL_LOCK = Lock()
_TRANSCRIBE_LOCK = Lock()


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise HTTPException(503, "语音识别组件尚未安装，请运行 Stage 9 安装脚本。") from exc
            # Stage 9 uses small CPU-friendly base model; never call Ollama here.
            try:
                _MODEL = WhisperModel("base", device="cpu", compute_type="int8")
            except Exception as exc:
                logger.exception("Local speech model could not be loaded")
                raise HTTPException(503, "本地 Whisper 模型无法加载；首次使用需要下载模型，请检查网络或模型缓存。") from exc
    return _MODEL


def _transcribe_path(path: str) -> dict:
    # Serialise CPU work so multiple simultaneous recordings do not exhaust RAM.
    with _TRANSCRIBE_LOCK:
        model = _get_model()
        try:
            segments, info = model.transcribe(
                path,
                language="zh",
                beam_size=2,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            duration = float(getattr(info, "duration", 0) or 0)
            if duration > MAX_AUDIO_SECONDS:
                raise HTTPException(413, "录音超过 2 分钟，请缩短后重试。")
            # Generator needs consumption for actual inference.
            text = "".join(segment.text for segment in segments).strip()
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Speech transcription failed")
            raise HTTPException(422, "音频无法识别，请检查录音格式和麦克风。") from exc
        return {"text": text, "language": "zh", "duration_seconds": round(duration, 1)}


def _file_extension(filename: str | None, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    if suffix in _ALLOWED_EXT:
        return suffix
    mime = (content_type or "").split(";", 1)[0].lower()
    known = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4",
             "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
             "audio/x-wav": "wav"}
    if mime in known:
        return known[mime]
    raise HTTPException(415, "不支持的录音格式，请使用浏览器麦克风录音。")


@router.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)):
    require_owner_id(request)
    ext = _file_extension(file.filename, file.content_type)
    mime = (file.content_type or "").lower()
    if mime and not (mime.startswith("audio/") or mime == "application/octet-stream"):
        raise HTTPException(415, "上传的文件不是音频。")

    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(prefix="defense_voice_", suffix="." + ext, delete=False) as tmp:
            temp_name = tmp.name
            size = 0
            while True:
                block = await file.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "录音文件过大（最大 18 MiB）。")
                tmp.write(block)
        if size < 128:
            raise HTTPException(422, "录音内容过短或为空，请重新录制。")
        # If the browser disconnects while CPU transcription is running, Starlette
        # can cancel the async request before the worker finishes. The worker must
        # therefore also delete the recording once it actually finishes on Windows.
        def transcribe_and_cleanup():
            try:
                return _transcribe_path(temp_name)
            finally:
                try:
                    os.unlink(temp_name)
                except FileNotFoundError:
                    pass
                except OSError:
                    logger.warning("Unable to delete completed audio temp file")
        return await run_in_threadpool(transcribe_and_cleanup)
    finally:
        await file.close()
        if temp_name:
            try:
                os.unlink(temp_name)
            except OSError:
                logger.warning("Failed to clean temporary audio file: %s", temp_name)
