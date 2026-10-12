"""Document Persistence & SQLite Store.

Provides local, persistent storage for parsed and confirmed student records.
- ACID-compliant SQLite local database.
- Automatic table initialization.
- Duplicate detection by (studentId / rollNumber + examName + examDate).
- Full audit tracking with confirmed timestamps and cryptographic document hash.
"""

import sqlite3
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from app.schemas import (
    DocumentConfirmationRequest,
    ConfirmedDocumentRecord,
    SubjectMark,
)

BASE_DIR = Path(__file__).resolve().parents[1]
DB_PATH = BASE_DIR / "data" / "student_documents.db"


def get_db_connection() -> sqlite3.Connection:
    """Open or create a SQLite database connection with row factory."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database tables for document storage."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS confirmed_documents (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                student_name TEXT NOT NULL,
                roll_number TEXT NOT NULL,
                institution TEXT,
                academic_class TEXT,
                exam_name TEXT,
                exam_date TEXT,
                subject_marks_json TEXT NOT NULL,
                total_obtained REAL,
                total_max REAL,
                percentage REAL,
                attendance_attended INTEGER,
                attendance_total INTEGER,
                document_hash TEXT,
                raw_text TEXT,
                notes TEXT,
                confirmed_at TEXT NOT NULL
            );
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_student_roll ON confirmed_documents(roll_number);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_document_id ON confirmed_documents(document_id);
        """)
        conn.commit()


def save_confirmed_document(
    request: DocumentConfirmationRequest,
    raw_text: str = "",
    document_hash: Optional[str] = None
) -> ConfirmedDocumentRecord:
    """Store or update a confirmed student document in the local database."""
    init_db()
    record_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    subjects_json = json.dumps([sm.model_dump() for sm in request.subjectMarks])

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check for potential duplicates (same roll number and exam name)
        cursor.execute(
            """
            SELECT id FROM confirmed_documents 
            WHERE roll_number = ? AND exam_name = ? AND exam_date IS ?
            LIMIT 1
            """,
            (request.rollNumber, request.examName, request.examDate)
        )
        existing = cursor.fetchone()
        if existing:
            # Update existing record
            target_id = existing["id"]
            cursor.execute(
                """
                UPDATE confirmed_documents SET
                    student_name = ?,
                    institution = ?,
                    academic_class = ?,
                    subject_marks_json = ?,
                    total_obtained = ?,
                    total_max = ?,
                    percentage = ?,
                    attendance_attended = ?,
                    attendance_total = ?,
                    document_hash = ?,
                    raw_text = ?,
                    notes = ?,
                    confirmed_at = ?
                WHERE id = ?
                """,
                (
                    request.studentName,
                    request.institution,
                    request.academicYearOrClass,
                    subjects_json,
                    request.totalObtained,
                    request.totalMax,
                    request.percentage,
                    request.attendanceAttended,
                    request.attendanceTotal,
                    document_hash,
                    raw_text,
                    request.notes,
                    now_iso,
                    target_id
                )
            )
            record_id = target_id
        else:
            cursor.execute(
                """
                INSERT INTO confirmed_documents (
                    id, document_id, student_name, roll_number, institution,
                    academic_class, exam_name, exam_date, subject_marks_json,
                    total_obtained, total_max, percentage, attendance_attended,
                    attendance_total, document_hash, raw_text, notes, confirmed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    request.documentId,
                    request.studentName,
                    request.rollNumber,
                    request.institution,
                    request.academicYearOrClass,
                    request.examName,
                    request.examDate,
                    subjects_json,
                    request.totalObtained,
                    request.totalMax,
                    request.percentage,
                    request.attendanceAttended,
                    request.attendanceTotal,
                    document_hash,
                    raw_text,
                    request.notes,
                    now_iso
                )
            )
        conn.commit()

    return ConfirmedDocumentRecord(
        id=record_id,
        documentId=request.documentId,
        studentName=request.studentName,
        rollNumber=request.rollNumber,
        institution=request.institution,
        academicYearOrClass=request.academicYearOrClass,
        examName=request.examName,
        examDate=request.examDate,
        subjectMarks=request.subjectMarks,
        totalObtained=request.totalObtained,
        totalMax=request.totalMax,
        percentage=request.percentage,
        attendanceAttended=request.attendanceAttended,
        attendanceTotal=request.attendanceTotal,
        documentHash=document_hash,
        rawText=raw_text,
        confirmedAt=now_iso,
        notes=request.notes
    )


def list_confirmed_documents(limit: int = 100, roll_number: Optional[str] = None) -> List[ConfirmedDocumentRecord]:
    """Retrieve list of saved confirmed student documents."""
    init_db()
    records: List[ConfirmedDocumentRecord] = []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if roll_number:
            cursor.execute(
                "SELECT * FROM confirmed_documents WHERE roll_number = ? ORDER BY confirmed_at DESC LIMIT ?",
                (roll_number, limit)
            )
        else:
            cursor.execute(
                "SELECT * FROM confirmed_documents ORDER BY confirmed_at DESC LIMIT ?",
                (limit,)
            )

        for row in cursor.fetchall():
            subjects_raw = json.loads(row["subject_marks_json"])
            subjects = [SubjectMark(**s) for s in subjects_raw]
            records.append(ConfirmedDocumentRecord(
                id=row["id"],
                documentId=row["document_id"],
                studentName=row["student_name"],
                rollNumber=row["roll_number"],
                institution=row["institution"],
                academicYearOrClass=row["academic_class"],
                examName=row["exam_name"],
                examDate=row["exam_date"],
                subjectMarks=subjects,
                totalObtained=row["total_obtained"],
                totalMax=row["total_max"],
                percentage=row["percentage"],
                attendanceAttended=row["attendance_attended"],
                attendanceTotal=row["attendance_total"],
                documentHash=row["document_hash"],
                rawText=row["raw_text"] or "",
                confirmedAt=row["confirmed_at"],
                notes=row["notes"]
            ))
    return records


def get_confirmed_document(record_id: str) -> Optional[ConfirmedDocumentRecord]:
    """Retrieve a single confirmed document by ID."""
    init_db()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM confirmed_documents WHERE id = ? OR document_id = ? LIMIT 1", (record_id, record_id))
        row = cursor.fetchone()
        if not row:
            return None
        subjects_raw = json.loads(row["subject_marks_json"])
        subjects = [SubjectMark(**s) for s in subjects_raw]
        return ConfirmedDocumentRecord(
            id=row["id"],
            documentId=row["document_id"],
            studentName=row["student_name"],
            rollNumber=row["roll_number"],
            institution=row["institution"],
            academicYearOrClass=row["academic_class"],
            examName=row["exam_name"],
            examDate=row["exam_date"],
            subjectMarks=subjects,
            totalObtained=row["total_obtained"],
            totalMax=row["total_max"],
            percentage=row["percentage"],
            attendanceAttended=row["attendance_attended"],
            attendanceTotal=row["attendance_total"],
            documentHash=row["document_hash"],
            rawText=row["raw_text"] or "",
            confirmedAt=row["confirmed_at"],
            notes=row["notes"]
        )
