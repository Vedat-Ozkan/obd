import uvicorn
from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def hello() -> dict[str, str]:
    return {"service": "hil-bridge", "status": "ok"}


def main() -> None:
    uvicorn.run(app, host="127.0.0.1", port=8000)
