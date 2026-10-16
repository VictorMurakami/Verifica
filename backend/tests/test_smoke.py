def test_runtime_dependencies_are_importable():
    import bs4  # noqa: F401
    import dotenv  # noqa: F401
    import fastapi  # noqa: F401
    import requests  # noqa: F401
    import trafilatura  # noqa: F401
    import tzdata  # noqa: F401
    import uvicorn  # noqa: F401
