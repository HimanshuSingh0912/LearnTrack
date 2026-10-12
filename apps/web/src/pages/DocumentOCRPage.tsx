import React, { useState, useEffect } from "react";

interface SubjectMark {
  subject: string;
  obtainedMarks?: number;
  maxMarks?: number;
  grade?: string;
}

interface ParsedDocument {
  documentId: string;
  studentName?: string;
  rollNumber?: string;
  institution?: string;
  academicYearOrClass?: string;
  examName?: string;
  examDate?: string;
  subjectMarks: SubjectMark[];
  totalObtained?: number;
  totalMax?: number;
  percentage?: number;
  attendanceAttended?: number;
  attendanceTotal?: number;
  documentHash?: string;
  rawText: string;
  warnings: string[];
  requiresReview: boolean;
}

interface ConfirmedRecord {
  id: string;
  studentName: string;
  rollNumber: string;
  institution?: string;
  examName?: string;
  subjectMarks: SubjectMark[];
  percentage?: number;
  confirmedAt: string;
  documentHash?: string;
}

export const DocumentOCRPage: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [language, setLanguage] = useState<string>("hi");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [confirmedRecords, setConfirmedRecords] = useState<ConfirmedRecord[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Editable Form State
  const [studentName, setStudentName] = useState<string>("");
  const [rollNumber, setRollNumber] = useState<string>("");
  const [institution, setInstitution] = useState<string>("");
  const [academicClass, setAcademicClass] = useState<string>("");
  const [examName, setExamName] = useState<string>("");
  const [examDate, setExamDate] = useState<string>("");
  const [subjectMarks, setSubjectMarks] = useState<SubjectMark[]>([]);
  const [totalObtained, setTotalObtained] = useState<string>("");
  const [totalMax, setTotalMax] = useState<string>("");
  const [percentage, setPercentage] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const ML_SERVICE_URL = "http://127.0.0.1:8000";

  useEffect(() => {
    fetchConfirmedDocuments();
  }, []);

  const fetchConfirmedDocuments = async () => {
    try {
      const res = await fetch(`${ML_SERVICE_URL}/documents?limit=20`);
      if (res.ok) {
        const data = await res.json();
        setConfirmedRecords(data);
      }
    } catch {
      // Backend may be offline during initial render
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setError(null);
      setParsedDoc(null);
    }
  };

  const handleProcessDocument = async () => {
    if (!selectedFile) {
      setError("Please select a document image to upload.");
      return;
    }

    setLoading(true);
    setError(null);
    setSaveSuccess(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(
        `${ML_SERVICE_URL}/documents/parse?language=${language}`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Upload failed with status ${response.status}`);
      }

      const data: ParsedDocument = await response.json();
      setParsedDoc(data);

      // Populate review form with extracted values
      setStudentName(data.studentName || "");
      setRollNumber(data.rollNumber || "");
      setInstitution(data.institution || "");
      setAcademicClass(data.academicYearOrClass || "");
      setExamName(data.examName || "");
      setExamDate(data.examDate || "");
      setSubjectMarks(data.subjectMarks || []);
      setTotalObtained(data.totalObtained ? String(data.totalObtained) : "");
      setTotalMax(data.totalMax ? String(data.totalMax) : "");
      setPercentage(data.percentage ? String(data.percentage) : "");
    } catch (err: any) {
      setError(err.message || "Failed to process document.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubject = () => {
    setSubjectMarks([...subjectMarks, { subject: "", obtainedMarks: 0, maxMarks: 100 }]);
  };

  const handleSubjectChange = (index: number, field: keyof SubjectMark, value: any) => {
    const updated = [...subjectMarks];
    updated[index] = { ...updated[index], [field]: value };
    setSubjectMarks(updated);
  };

  const handleRemoveSubject = (index: number) => {
    setSubjectMarks(subjectMarks.filter((_, i) => i !== index));
  };

  const handleConfirmAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsedDoc) return;

    if (!studentName.trim() || !rollNumber.trim()) {
      setError("Student Name and Roll Number are required.");
      return;
    }

    setLoading(true);
    setError(null);

    const confirmationPayload = {
      documentId: parsedDoc.documentId,
      studentName: studentName.trim(),
      rollNumber: rollNumber.trim(),
      institution: institution.trim() || undefined,
      academicYearOrClass: academicClass.trim() || undefined,
      examName: examName.trim() || undefined,
      examDate: examDate.trim() || undefined,
      subjectMarks: subjectMarks.filter((s) => s.subject.trim().length > 0),
      totalObtained: totalObtained ? parseFloat(totalObtained) : undefined,
      totalMax: totalMax ? parseFloat(totalMax) : undefined,
      percentage: percentage ? parseFloat(percentage) : undefined,
      notes: notes.trim() || undefined,
    };

    try {
      const response = await fetch(`${ML_SERVICE_URL}/documents/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmationPayload),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || "Failed to save record.");
      }

      setSaveSuccess("Student document record successfully verified and saved!");
      setParsedDoc(null);
      fetchConfirmedDocuments();
    } catch (err: any) {
      setError(err.message || "Failed to save record.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Document Ingestion & BHASHINI OCR
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Upload student report cards or academic marksheets. Extract text using Digital India's BHASHINI OCR, review parsed fields, and confirm records.
        </p>
      </div>

      {/* Notifications / Alerts */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-red-700 text-sm">
          <strong>Error: </strong> {error}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded text-green-700 text-sm">
          <strong>Success: </strong> {saveSuccess}
        </div>
      )}

      {/* Upload Box */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Upload Document</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Image (PNG, JPG, WEBP, up to 5 MB)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              OCR Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full border border-gray-300 rounded-md p-2 text-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="hi">Hindi (hi)</option>
              <option value="en">English (en)</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleProcessDocument}
            disabled={loading || !selectedFile}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white ${
              loading || !selectedFile
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 shadow-sm"
            }`}
          >
            {loading ? "Processing with BHASHINI..." : "Extract & Parse Document"}
          </button>
        </div>
      </div>

      {/* Review & Edit Form */}
      {parsedDoc && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 space-y-6">
          <div className="border-b pb-4">
            <h2 className="text-lg font-medium text-gray-900">
              Review & Verify Extracted Fields
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Document SHA-256 Hash: <code className="bg-gray-100 px-1 py-0.5 rounded">{parsedDoc.documentHash}</code>
            </p>
          </div>

          {/* Warnings Banner */}
          {parsedDoc.warnings.length > 0 && (
            <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded text-amber-800 text-sm">
              <strong className="block font-semibold mb-1">Attention Required:</strong>
              <ul className="list-disc list-inside space-y-1">
                {parsedDoc.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <form onSubmit={handleConfirmAndSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Student Name *
                </label>
                <input
                  type="text"
                  required
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Roll Number / Identifier *
                </label>
                <input
                  type="text"
                  required
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Institution / School
                </label>
                <input
                  type="text"
                  value={institution}
                  onChange={(e) => setInstitution(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Class / Grade
                </label>
                <input
                  type="text"
                  value={academicClass}
                  onChange={(e) => setAcademicClass(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Examination Name
                </label>
                <input
                  type="text"
                  value={examName}
                  onChange={(e) => setExamName(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Examination Date
                </label>
                <input
                  type="text"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Subject Marks Table */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-semibold text-gray-800 uppercase">Subject Marks</h3>
                <button
                  type="button"
                  onClick={handleAddSubject}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add Subject
                </button>
              </div>

              <div className="border border-gray-200 rounded-md overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2 text-left">Subject</th>
                      <th className="px-4 py-2 text-left">Obtained Marks</th>
                      <th className="px-4 py-2 text-left">Max Marks</th>
                      <th className="px-4 py-2 text-left">Grade</th>
                      <th className="px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {subjectMarks.map((sm, index) => (
                      <tr key={index}>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={sm.subject}
                            onChange={(e) => handleSubjectChange(index, "subject", e.target.value)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={sm.obtainedMarks ?? ""}
                            onChange={(e) =>
                              handleSubjectChange(
                                index,
                                "obtainedMarks",
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )
                            }
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={sm.maxMarks ?? ""}
                            onChange={(e) =>
                              handleSubjectChange(
                                index,
                                "maxMarks",
                                e.target.value ? parseFloat(e.target.value) : undefined
                              )
                            }
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={sm.grade || ""}
                            onChange={(e) => handleSubjectChange(index, "grade", e.target.value)}
                            className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveSubject(index)}
                            className="text-red-500 hover:text-red-700 text-xs font-semibold"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Aggregates & Raw OCR Accordion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Total Marks Obtained
                </label>
                <input
                  type="number"
                  value={totalObtained}
                  onChange={(e) => setTotalObtained(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Total Maximum Marks
                </label>
                <input
                  type="number"
                  value={totalMax}
                  onChange={(e) => setTotalMax(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Percentage (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-sm"
                />
              </div>
            </div>

            {/* Raw Text Preview */}
            <details className="text-xs text-gray-600 bg-gray-50 p-3 rounded border">
              <summary className="font-semibold cursor-pointer">View Original Raw OCR Text</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-gray-700 max-h-40 overflow-y-auto">
                {parsedDoc.rawText}
              </pre>
            </details>

            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => setParsedDoc(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-md text-sm shadow-sm"
              >
                {loading ? "Saving..." : "Verify & Save Record"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmed Records Table */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Saved Student Documents</h2>
        {confirmedRecords.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No verified records saved yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-4 py-2 text-left">Student Name</th>
                  <th className="px-4 py-2 text-left">Roll Number</th>
                  <th className="px-4 py-2 text-left">Examination</th>
                  <th className="px-4 py-2 text-left">Percentage</th>
                  <th className="px-4 py-2 text-left">Confirmed Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {confirmedRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{rec.studentName}</td>
                    <td className="px-4 py-2 text-gray-600">{rec.rollNumber}</td>
                    <td className="px-4 py-2 text-gray-600">{rec.examName || "—"}</td>
                    <td className="px-4 py-2 text-gray-900">
                      {rec.percentage !== undefined && rec.percentage !== null
                        ? `${rec.percentage}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {new Date(rec.confirmedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
