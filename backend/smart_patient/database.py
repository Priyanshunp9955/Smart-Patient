import os

import mysql.connector
from dotenv import load_dotenv

from .config import BACKEND_DIR

load_dotenv(BACKEND_DIR / ".env")


def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        connection_timeout=5
    )
