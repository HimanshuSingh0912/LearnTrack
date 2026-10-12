import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas import DocumentConfirmationRequest, SubjectMark

client = TestClient(app)


def test_document_confirmation_and_retrieval_lifecycle():
    # 1. Save confirmed document
    req_payload = {
        "documentId": "doc-uuid-12345",
        "studentName": "Priya Patel",
        "rollNumber": "S-9901",
        "institution": "National High School",
        "academicYearOrClass": "Grade 11",
        "examName": "Term 1 Assessment",
        "examDate": "2026-11-01T00:00:00Z",
        "subjectMarks": [
            {"subject": "DSA", "obtainedMarks": 84, "maxMarks": 100, "grade": "A"},
            {"subject": "Mathematics", "obtainedMarks": 78, "maxMarks": 100, "grade": "B"}
        ],
        "totalObtained": 162,
        "totalMax": 200,
        "percentage": 81.0,
        "attendanceAttended": 40,
        "attendanceTotal": 45,
        "notes": "Verified by counselor"
    }

    confirm_res = client.post("/documents/confirm", json=req_payload)
    assert confirm_res.status_code == 200
    rec = confirm_res.json()
    assert rec["studentName"] == "Priya Patel"
    assert rec["rollNumber"] == "S-9901"
    doc_id = rec["id"]

    # 2. Retrieve document by ID
    get_res = client.get(f"/documents/{doc_id}")
    assert get_res.status_code == 200
    assert get_res.json()["rollNumber"] == "S-9901"

    # 3. List documents
    list_res = client.get("/documents?rollNumber=S-9901")
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # 4. Check summary analytics
    analytics_res = client.get("/analytics/summary")
    assert analytics_res.status_code == 200
    summary = analytics_res.json()
    assert summary["hasData"] is True
    assert summary["totalRecords"] >= 1
    assert "dsa" in summary["subjectAverages"]

    # 5. Check prediction bridge
    with TestClient(app) as test_client:
        bridge_res = test_client.post(f"/documents/{doc_id}/predict-compatibility")
        assert bridge_res.status_code == 200
        bridge_data = bridge_res.json()
        assert bridge_data["compatible"] is True
        assert "prediction" in bridge_data
