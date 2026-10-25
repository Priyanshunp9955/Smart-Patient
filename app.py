"""Root development entry point using the canonical backend package."""

if __package__:
    from .backend.smart_patient import create_app
else:
    from backend.smart_patient import create_app

app = create_app()


if __name__ == "__main__":
    app.run(debug=True)
