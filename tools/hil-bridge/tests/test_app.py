from fastapi.testclient import TestClient

from hil_bridge.app import app


def test_hello() -> None:
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert response.json() == {"service": "hil-bridge", "status": "ok"}
