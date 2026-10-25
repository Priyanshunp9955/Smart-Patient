"""Additive, repeatable profile migration; never recreate patients or change rows."""
import click
from mysql.connector import Error

from .database import get_db_connection

PROFILE_COLUMNS = {
    "phone": "VARCHAR(32) NULL DEFAULT NULL",
    "date_of_birth": "DATE NULL DEFAULT NULL",
    "gender": "VARCHAR(32) NULL DEFAULT NULL",
    "blood_group": "VARCHAR(3) NULL DEFAULT NULL",
    "profile_photo": "MEDIUMBLOB NULL DEFAULT NULL",
    "profile_photo_version": "CHAR(32) NULL DEFAULT NULL",
}


def migrate_patient_profile(connection):
    cursor = connection.cursor()
    locked = False
    try:
        cursor.execute("SELECT GET_LOCK('smarthealth_patient_profile', 10)")
        locked = cursor.fetchone()[0] == 1
        if not locked:
            raise click.ClickException("Another profile migration is running. Try again later.")
        cursor.execute("""SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'patients'""")
        existing = {row[0].lower() for row in cursor.fetchall()}
        if not {"id", "full_name", "email", "password_hash"}.issubset(existing):
            raise click.ClickException("Expected patients table was not found. No schema changes made.")
        missing = [name for name in PROFILE_COLUMNS if name not in existing]
        if missing:
            # Identifiers and types are fixed constants, never user input. One additive ALTER.
            additions = ", ".join(f"ADD COLUMN `{name}` {PROFILE_COLUMNS[name]}" for name in missing)
            cursor.execute("ALTER TABLE patients " + additions)
        return missing
    finally:
        try:
            if locked:
                cursor.execute("SELECT RELEASE_LOCK('smarthealth_patient_profile')")
                cursor.fetchone()
        finally:
            cursor.close()


def register_commands(app):
    @app.cli.command("migrate-profile")
    def migrate_profile():
        """Add only missing nullable profile columns to the existing patients table."""
        connection = None
        try:
            connection = get_db_connection()
            added = migrate_patient_profile(connection)
            click.echo("Added profile columns: " + ", ".join(added) if added else "Profile schema is already up to date.")
        except Error as error:
            if error.errno == 1142:
                raise click.ClickException("MySQL denied ALTER on patients. Run this command with a database account that has ALTER permission; existing data has not been changed.") from error
            raise click.ClickException("Profile migration failed. Check MySQL availability and ALTER permissions.") from error
        finally:
            if connection is not None and connection.is_connected():
                connection.close()
