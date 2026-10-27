"""从环境变量读取数据库和会话配置。"""

import os
from dataclasses import dataclass
from urllib.parse import quote_plus


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    bootstrap_username: str
    bootstrap_password: str | None
    cookie_secure: bool


def get_settings() -> Settings:
    secret = os.getenv("JWT_SECRET_KEY", "")
    if len(secret) < 32:
        raise RuntimeError("JWT_SECRET_KEY 至少需要 32 个字符")
    user = quote_plus(os.getenv("MYSQL_USER", "finrag"))
    password = quote_plus(os.getenv("MYSQL_PASSWORD", ""))
    host = os.getenv("MYSQL_HOST", "mysql")
    port = os.getenv("MYSQL_PORT", "3306")
    database = quote_plus(os.getenv("MYSQL_DATABASE", "finrag"))
    return Settings(
        database_url=os.getenv(
            "DATABASE_URL", f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}?charset=utf8mb4"
        ),
        jwt_secret=secret,
        bootstrap_username=os.getenv("ADMIN_BOOTSTRAP_USERNAME", "admin"),
        bootstrap_password=os.getenv("ADMIN_BOOTSTRAP_PASSWORD") or None,
        cookie_secure=os.getenv("APP_ENV", "development") != "development",
    )
