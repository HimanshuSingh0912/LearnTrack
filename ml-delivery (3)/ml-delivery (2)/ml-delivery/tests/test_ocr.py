import io
from fastapi.testclient import TestClient
from unittest.mock import patch
from app.main import app

client = TestClient(app)


def test_root_endpoint_prompt_response():
    """Verify GET / returns quickly with informative payload."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "running"
    assert "docs" in data


def test_health_endpoint_prompt_without_calling_bhashini():
    """Verify GET /health returns quickly and does not invoke external network."""
    with patch("httpx.AsyncClient.post") as mock_http:
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "modelLoaded" in data
        assert "ocr" in data
        # Ensure no external HTTP request was made by /health
        mock_http.assert_not_called()
        # Ensure sensitive credentials are never exposed
        assert "api_key" not in data["ocr"]
        assert "Authorization" not in str(data)
        assert data["ocr"]["configured"] is True


def test_openapi_json_available():
    """Verify /openapi.json generates correctly without requiring OCR calls."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "paths" in schema
    assert "/ocr" in schema["paths"]
    assert "/health" in schema["paths"]
    assert "/predict" in schema["paths"]


def test_docs_page_available():
    """Verify /docs Swagger UI loads successfully."""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")


def test_ocr_rejects_non_image():
    fake_file = io.BytesIO(b"Hello world text file")
    response = client.post(
        "/ocr",
        files={"file": ("test.txt", fake_file, "text/plain")}
    )
    assert response.status_code == 400
    assert "Uploaded file must be an image" in response.json()["detail"]


def test_ocr_rejects_empty_file():
    empty_file = io.BytesIO(b"")
    response = client.post(
        "/ocr",
        files={"file": ("test.png", empty_file, "image/png")}
    )
    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_ocr_rejects_oversized_file():
    # 6 MB file exceeds the 5 MB limit
    large_bytes = b"x" * (6 * 1024 * 1024)
    large_file = io.BytesIO(large_bytes)
    response = client.post(
        "/ocr",
        files={"file": ("large.png", large_file, "image/png")}
    )
    assert response.status_code == 413
    assert "exceeds the maximum" in response.json()["detail"]


@patch("app.bhashini_ocr.call_bhashini_ocr")
def test_ocr_success_mock(mock_call):
    mock_call.return_value = {
        "pipelineResponse": [
            {
                "taskType": "ocr",
                "config": None,
                "output": [
                    {"source": "Learner Score: 92/100", "target": ""}
                ]
            }
        ]
    }
    sample_file = io.BytesIO(b"\x89PNG\r\n\x1a\nfakeimagecontent")
    response = client.post(
        "/ocr",
        files={"file": ("report.png", sample_file, "image/png")}
    )
    assert response.status_code == 200
    res = response.json()
    assert res["success"] is True
    assert res["extractedText"] == "Learner Score: 92/100"
    assert len(res["rawOutputs"]) == 1
    assert res["rawOutputs"][0]["source"] == "Learner Score: 92/100"


@patch("httpx.AsyncClient.post")
def test_ocr_upstream_failure_handling(mock_post):
    """Verify upstream BHASHINI failure returns safe controlled HTTP 502 error."""
    import httpx
    # Simulate upstream 500 error
    mock_response = httpx.Response(
        status_code=500,
        text="Internal Server Error",
        request=httpx.Request("POST", "https://example.com")
    )
    mock_post.return_value = mock_response

    sample_file = io.BytesIO(b"\x89PNG\r\n\x1a\nfakeimagecontent")
    response = client.post(
        "/ocr",
        files={"file": ("report.png", sample_file, "image/png")}
    )
    assert response.status_code == 502
    assert "BHASHINI upstream service failed" in response.json()["detail"]


def test_existing_prediction_endpoint():
    # Verify that existing ML predict endpoint continues to be intact and working
    with TestClient(app) as test_client:
        sample_request = {
            "studentId": "S-TEST",
            "subject": "DSA",
            "asOf": "2026-12-01T00:00:00Z",
            "observations": [
                {
                    "observedAt": "2026-11-20T00:00:00Z",
                    "attendanceAttended": 8,
                    "attendanceTotal": 10,
                    "assessmentScore": 65,
                    "assessmentMax": 100,
                    "assignmentsSubmitted": 4,
                    "assignmentsDue": 5,
                    "lmsActiveDays": 12,
                    "facultyAcademicConcern": False
                }
            ]
        }
        response = test_client.post("/predict", json=sample_request)
        assert response.status_code == 200
        data = response.json()
        assert data["studentId"] == "S-TEST"
        assert "reviewSuggested" in data
