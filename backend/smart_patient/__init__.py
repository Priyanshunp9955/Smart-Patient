"""Application setup and route registration."""
from flask import Flask
from .config import configure_app


def create_app():
    app = Flask(__name__, static_folder=None)
    configure_app(app)
    from .routes import auth, frontend, photos, profile, readings, system
    from .migrations import register_commands
    register_commands(app)
    for blueprint in (frontend.blueprint, system.blueprint, auth.blueprint, readings.blueprint, profile.blueprint, photos.blueprint):
        app.register_blueprint(blueprint)
    return app
