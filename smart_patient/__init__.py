"""Application setup and route registration."""
from flask import Flask
from .config import configure_app


def create_app():
    app = Flask(__name__, static_folder=None)
    configure_app(app)
    from .routes import auth, frontend, readings, system
    for blueprint in (frontend.blueprint, system.blueprint, auth.blueprint, readings.blueprint):
        app.register_blueprint(blueprint)
    return app
