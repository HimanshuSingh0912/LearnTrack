import pytest
from app.document_parser import (
    parse_student_document,
    compute_sha256,
    extract_field_by_patterns,
    parse_subject_marks,
    NAME_PATTERNS,
    ROLL_PATTERNS
)
from app.schemas import SubjectMark


def test_compute_sha256_deterministic():
    content = b"LearnTrack student document bytes"
    h1 = compute_sha256(content)
    h2 = compute_sha256(content)
    assert h1 == h2
    assert len(h1) == 64


def test_parse_english_student_marksheet():
    raw_text = """
    DELHI PUBLIC SCHOOL
    STUDENT REPORT CARD 2026
    Student Name: Aarav Sharma
    Roll No: DPS-2026-1049
    Class: X-A
    Exam Name: Mid-Term Examination 2026
    Date: 15/09/2026

    Mathematics: 88 / 100
    Science: 91 / 100
    English: 82 / 100
    Social Studies: 85 / 100
    Hindi: 79 / 100

    Total Marks: 425 / 500
    Percentage: 85%
    Attendance: 76 / 80
    """

    doc = parse_student_document(raw_text)

    assert doc.studentName == "Aarav Sharma"
    assert doc.rollNumber == "DPS-2026-1049"
    assert doc.academicYearOrClass == "X-A"
    assert doc.examName == "Mid-Term Examination 2026"
    assert len(doc.subjectMarks) == 5

    # Check math score
    math_subj = next(s for s in doc.subjectMarks if "math" in s.subject.lower())
    assert math_subj.obtainedMarks == 88.0
    assert math_subj.maxMarks == 100.0

    assert doc.totalObtained == 425.0
    assert doc.totalMax == 500.0
    assert doc.percentage == 85.0
    assert doc.attendanceAttended == 76
    assert doc.attendanceTotal == 80
    assert doc.requiresReview is False


def test_parse_hindi_student_document():
    raw_text = """
    केंद्रीय विद्यालय
    छात्र का नाम : रोहन वर्मा
    अनुक्रमांक : KV-9874
    कक्षा : बारहवीं
    परीक्षा : अर्धवार्षिक परीक्षा

    गणित : 94 / 100
    भौतिकी : 87 / 100
    रसायन : 89 / 100

    कुल अंक : 270 / 300
    प्रतिशत : 90%
    उपस्थिति : 45 / 50
    """

    doc = parse_student_document(raw_text)

    assert doc.studentName == "रोहन वर्मा"
    assert doc.rollNumber == "KV-9874"
    assert len(doc.subjectMarks) == 3
    assert doc.totalObtained == 270.0
    assert doc.percentage == 90.0
    assert doc.attendanceAttended == 45
    assert doc.requiresReview is False


def test_ambiguous_and_missing_fields_flag_review():
    raw_text = """
    UNKNOWN DOCUMENT FRAGMENT
    Mathematics: 110 / 100
    """

    doc = parse_student_document(raw_text)

    # Missing student name and roll number must trigger review
    assert doc.studentName is None
    assert doc.rollNumber is None
    assert doc.requiresReview is True
    assert len(doc.warnings) >= 2
    # Mark exceeding max marks should be flagged
    assert any("exceed" in w.lower() for w in doc.warnings)
