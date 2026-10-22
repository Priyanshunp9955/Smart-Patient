"""Flask entry point; run with python backend/app.py from the project root."""

if __package__:
    from .smart_patient import create_app
else:
    from smart_patient import create_app

app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
