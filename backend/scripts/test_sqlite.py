import sqlite3

from app.core.config import get_settings


def main() -> None:
    db_file = get_settings().sqlite_file
    db_file.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_file) as conn:
        result = conn.execute("SELECT sqlite_version()").fetchone()
        assert result is not None
    print(f"SQLite 本地数据库正常：{db_file}")
    print(f"SQLite 版本：{result[0]}")


if __name__ == "__main__":
    main()
