"""Dynamic Student Document Parser Module.

Parses unstructured, multi-lingual (English and Hindi) OCR text extracted
from various student documents, report cards, transcripts, and marksheets.

Rules:
- Never fabricates data.
- Handles variable subjects, differing layouts, and missing fields.
- Distinguishes confident extractions from ambiguous ones.
- Computes SHA-256 integrity hash of document content.
"""

import re
import hashlib
import uuid
from typing import Dict, Any, List, Optional, Tuple
from app.schemas import SubjectMark, ParsedStudentDocument


# Keywords for metadata fields (English & Hindi)
NAME_PATTERNS = [
    r"(?:Student\s*Name|Candidate\s*Name|Name\s*of\s*Student|Name|विद्यार्थी\s*का\s*नाम|छात्र\s*का\s*नाम|नाम)\s*[:\-–]\s*([A-Za-z\u0900-\u097F\s\.]+)",
]

ROLL_PATTERNS = [
    r"(?:Roll\s*No(?:\.|\b)|Roll\s*Number|Registration\s*No(?:\.|\b)|Reg\s*No(?:\.|\b)|Student\s*ID|Enrollment\s*No(?:\.|\b)|अनुक्रमांक|नामांकन\s*संख्या)\s*[:\-–]\s*([A-Za-z0-9\-_/]+)",
]

INSTITUTION_PATTERNS = [
    r"(?:School\s*Name|College\s*Name|Institution|University|विद्यालय|स्कूल|महाविद्यालय)\s*[:\-–]\s*([A-Za-z\u0900-\u097F0-9\s,\.\-]+)",
]

CLASS_PATTERNS = [
    r"(?:Class|Grade|Standard|Std|Semester|Sem|कक्षा)\s*[:\-–]\s*([A-Za-z0-9IVXLCDM\s\-\.]+)",
]

EXAM_PATTERNS = [
    r"(?:Exam\s*Name|Examination|Assessment|Term|परीक्षा)\s*[:\-–]\s*([A-Za-z0-9\u0900-\u097F\s\-\.]+)",
]

DATE_PATTERNS = [
    r"(?:Date|Dated|दिनांक|तारीख)\s*[:\-–]\s*(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})",
    r"\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b",
]

TOTAL_PATTERNS = [
    r"(?:Total\s*Marks|Grand\s*Total|Aggregate|कुल\s*अंक|योग)\s*[:\-–]?\s*(\d+(?:\.\d+)?)\s*(?:[\/|out\s*of]\s*(\d+(?:\.\d+)?))?",
]

PERCENTAGE_PATTERNS = [
    r"(?:Percentage|Percent|प्रतिशत)\s*[:\-–]?\s*(\d+(?:\.\d+)?)\s*%",
    r"(\d+(?:\.\d+)?)\s*%",
]

ATTENDANCE_PATTERNS = [
    r"(?:Attendance|उपस्थिति)\s*[:\-–]?\s*(\d+)\s*(?:[\/|out\s*of]\s*(\d+))?",
]

# Standard subjects to aid recognition across English and Hindi
KNOWN_SUBJECT_TERMS = {
    "mathematics": ["math", "maths", "mathematics", "गणित"],
    "science": ["science", "sci", "विज्ञान"],
    "physics": ["physics", "phy", "भौतिकी"],
    "chemistry": ["chemistry", "chem", "रसायन"],
    "biology": ["biology", "bio", "जीवविज्ञान"],
    "english": ["english", "eng", "अंग्रेजी"],
    "hindi": ["hindi", "हिंदी", "हिन्दी"],
    "social science": ["social science", "social studies", "sst", "सामाजिक विज्ञान"],
    "history": ["history", "इतिहास"],
    "geography": ["geography", "भूगोल"],
    "computer science": ["computer science", "computer", "cs", "it", "कंप्यूटर"],
    "dsa": ["dsa", "data structures", "data structures & algorithms"],
}


def compute_sha256(content: bytes) -> str:
    """Compute deterministic SHA-256 hash of binary content."""
    hasher = hashlib.sha256()
    hasher.update(content)
    return hasher.hexdigest()


def extract_field_by_patterns(text: str, patterns: List[str]) -> Optional[str]:
    """Extract first matching string group from regex patterns."""
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match and match.group(1):
            val = match.group(1).strip()
            # Basic sanity check
            if len(val) > 0 and len(val) < 150:
                # Strip trailing line breaks or noise
                val = val.split("\n")[0].strip()
                return val
    return None


def parse_subject_marks(lines: List[str]) -> Tuple[List[SubjectMark], List[str]]:
    """Dynamically extract subject marks from lines of OCR text."""
    subject_marks: List[SubjectMark] = []
    warnings: List[str] = []

    # Regex for lines like:
    # "Mathematics: 85 / 100"
    # "Science - 78/100 (Grade A)"
    # "Hindi 92"
    # "Physics: 45 out of 50"
    mark_line_regex = re.compile(
        r"^([A-Za-z\u0900-\u097F\s&]{2,30})[:\-–\s]+(\d+(?:\.\d+)?)\s*(?:[\/|out\s*of]+\s*(\d+(?:\.\d+)?))?(?:\s*(?:Grade|grade)?\s*([A-F][+\-]?))?",
        re.IGNORECASE
    )

    METADATA_STOP_WORDS = [
        "total", "aggregate", "percentage", "percent", "roll no", "roll number", "student id",
        "name", "school", "college", "institution", "attendance", "date", "class", "grade",
        "report card", "exam", "examination", "term", "semester", "standard",
        "कुल अंक", "योग", "प्रतिशत", "अनुक्रमांक", "नाम", "कक्षा", "परीक्षा", "उपस्थिति", "दिनांक", "तारीख"
    ]

    for line in lines:
        cleaned = line.strip()
        if not cleaned:
            continue

        cleaned_lower = cleaned.lower()
        if any(w in cleaned_lower for w in METADATA_STOP_WORDS):
            continue

        match = mark_line_regex.match(cleaned)
        if match:
            sub_name = match.group(1).strip()
            # Discard if subject name looks like purely numbers or punctuation
            if len(sub_name) < 2 or re.match(r"^\d+$", sub_name):
                continue

            try:
                obtained = float(match.group(2))
            except ValueError:
                continue

            max_m = None
            if match.group(3):
                try:
                    max_m = float(match.group(3))
                except ValueError:
                    max_m = None

            grade = match.group(4) if match.group(4) else None

            # Mark validation: obtained should not exceed max if max is provided
            if max_m is not None and obtained > max_m:
                warnings.append(f"Ambiguous score in '{sub_name}': obtained marks ({obtained}) exceed max marks ({max_m}).")

            subject_marks.append(SubjectMark(
                subject=sub_name,
                obtainedMarks=obtained,
                maxMarks=max_m,
                grade=grade
            ))

    return subject_marks, warnings


def parse_student_document(
    raw_text: str,
    image_bytes: Optional[bytes] = None,
    document_id: Optional[str] = None
) -> ParsedStudentDocument:
    """Parse raw OCR text into a structured ParsedStudentDocument object."""
    doc_id = document_id or str(uuid.uuid4())
    doc_hash = compute_sha256(image_bytes) if image_bytes else compute_sha256(raw_text.encode("utf-8"))

    warnings: List[str] = []
    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]

    # 1. Metadata extraction
    student_name = extract_field_by_patterns(raw_text, NAME_PATTERNS)
    roll_number = extract_field_by_patterns(raw_text, ROLL_PATTERNS)
    institution = extract_field_by_patterns(raw_text, INSTITUTION_PATTERNS)
    academic_class = extract_field_by_patterns(raw_text, CLASS_PATTERNS)
    exam_name = extract_field_by_patterns(raw_text, EXAM_PATTERNS)
    exam_date = extract_field_by_patterns(raw_text, DATE_PATTERNS)

    # 2. Subject marks extraction
    subject_marks, mark_warnings = parse_subject_marks(lines)
    warnings.extend(mark_warnings)

    # 3. Totals extraction
    total_obtained: Optional[float] = None
    total_max: Optional[float] = None
    for pattern in TOTAL_PATTERNS:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            try:
                total_obtained = float(match.group(1))
                if match.group(2):
                    total_max = float(match.group(2))
            except (ValueError, IndexError):
                pass
            break

    # If totals weren't in text but we have subject marks, verify or compute
    if total_obtained is None and len(subject_marks) > 0 and all(sm.obtainedMarks is not None for sm in subject_marks):
        calculated_tot = sum(sm.obtainedMarks for sm in subject_marks)
        total_obtained = calculated_tot
        if all(sm.maxMarks is not None for sm in subject_marks):
            total_max = sum(sm.maxMarks for sm in subject_marks)

    # 4. Percentage extraction
    percentage: Optional[float] = None
    for pattern in PERCENTAGE_PATTERNS:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            try:
                percentage = float(match.group(1))
            except ValueError:
                pass
            break

    if percentage is None and total_obtained is not None and total_max is not None and total_max > 0:
        percentage = round((total_obtained / total_max) * 100.0, 2)

    # 5. Attendance extraction
    att_attended: Optional[int] = None
    att_total: Optional[int] = None
    for pattern in ATTENDANCE_PATTERNS:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            try:
                att_attended = int(match.group(1))
                if match.group(2):
                    att_total = int(match.group(2))
            except (ValueError, IndexError):
                pass
            break

    # Flag missing or ambiguous fields for human review
    requires_review = False
    if not student_name:
        warnings.append("Student Name could not be detected automatically. Please verify.")
        requires_review = True
    if not roll_number:
        warnings.append("Roll Number could not be detected automatically. Please verify.")
        requires_review = True
    if len(subject_marks) == 0:
        warnings.append("No subject marks were detected in the document text.")
        requires_review = True

    return ParsedStudentDocument(
        documentId=doc_id,
        studentName=student_name,
        rollNumber=roll_number,
        institution=institution,
        academicYearOrClass=academic_class,
        examName=exam_name,
        examDate=exam_date,
        subjectMarks=subject_marks,
        totalObtained=total_obtained,
        totalMax=total_max,
        percentage=percentage,
        attendanceAttended=att_attended,
        attendanceTotal=att_total,
        documentHash=doc_hash,
        rawText=raw_text,
        warnings=warnings,
        requiresReview=requires_review
    )
