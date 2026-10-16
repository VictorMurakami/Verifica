import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        reload=True,
        reload_includes=["*.py", "*.md"],
    )
