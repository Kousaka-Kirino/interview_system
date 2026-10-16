from openai import OpenAI

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    if not settings.deepseek_api_key or settings.deepseek_api_key == "replace_with_your_own_key":
        raise SystemExit("请先在项目根目录的 .env 中设置 DEEPSEEK_API_KEY")

    client = OpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        timeout=40.0,
        max_retries=1,
    )
    response = client.chat.completions.create(
        model=settings.deepseek_model,
        messages=[
            {"role": "system", "content": "你是简洁的 API 连接测试助手。"},
            {"role": "user", "content": "请用一句中文确认连接成功。"},
        ],
        max_tokens=80,
    )
    print("DeepSeek API 返回：")
    print(response.choices[0].message.content or "<空响应>")


if __name__ == "__main__":
    main()
