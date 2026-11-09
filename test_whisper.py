
from pathlib import Path
import sys
from faster_whisper import WhisperModel

if len(sys.argv) < 2:
    print('用法: python test_whisper.py "录音文件路径"')
    sys.exit(1)

audio = Path(sys.argv[1])
if not audio.is_file():
    print(f"找不到音频文件: {audio}")
    sys.exit(1)

print("[1/3] 加载 Whisper base 模型...")
model = WhisperModel("base", device="cpu", compute_type="int8")

print("[2/3] 开始语音识别...")
segments, info = model.transcribe(
    str(audio),
    language="zh",
    beam_size=2,
    vad_filter=True,
    condition_on_previous_text=False,
)

# 必须遍历 segments 才会真正执行识别
text = "".join(s.text for s in segments).strip()

print("[3/3] 识别完成")
print(f"音频时长: {info.duration:.1f} 秒")
print(f"识别结果: {text or '（空）'}")
