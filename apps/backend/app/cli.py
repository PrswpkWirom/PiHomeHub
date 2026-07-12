from __future__ import annotations

import argparse
import getpass

from app.core.security import hash_password
from app.database.db import Base, SessionLocal, engine
from app.models.user import AuditEvent, User


def create_admin(username: str | None = None, *, allow_additional_admin: bool = False) -> None:
    Base.metadata.create_all(bind=engine)
    normalized = (username or input("Administrator username: ")).strip().casefold()
    if not normalized:
        raise SystemExit("Username is required")
    password = getpass.getpass("Administrator password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match")
    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    db = SessionLocal()
    try:
        if not allow_additional_admin and db.query(User).filter(User.is_admin.is_(True), User.is_active.is_(True)).first():
            raise SystemExit("An active administrator already exists; use --allow-additional-admin only after review")
        if db.query(User).filter(User.username == normalized).one_or_none() is not None:
            raise SystemExit("That username already exists")
        user = User(username=normalized, password_hash=password_hash, is_admin=True, is_active=True)
        db.add(user)
        db.flush()
        db.add(
            AuditEvent(
                actor_user_id=user.id,
                event="administrator_creation",
                target_type="user",
                target_identifier=str(user.id),
                success=True,
                metadata_json="{}",
            )
        )
        db.commit()
    finally:
        db.close()
    print(f"Administrator {normalized!r} created")


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-admin")
    create.add_argument("--username")
    create.add_argument("--allow-additional-admin", action="store_true")
    args = parser.parse_args()
    if args.command == "create-admin":
        create_admin(args.username, allow_additional_admin=args.allow_additional_admin)


if __name__ == "__main__":
    main()
