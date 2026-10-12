"""LearnTrack BHASHINI OCR Service Module.

Provides robust, production-ready OCR client functionality connecting to
Digital India's BHASHINI Dhruva Inference API pipeline.
"""

import os
import base64
import logging
from typing import Optional, Dict, Any, List

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, File, UploadFile, HTTPException, Query
from app.schemas import OCRResponse, OCRResultItem, ParsedStudentDocument
from app.document_parser import parse_student_document

# Configure logger
logger = logging.getLogger("bhashini_ocr")
logger.setLevel(logging.INFO)

# Load environment configuration from .env
load_dotenv()

# Configuration constants
DEFAULT_BHASHINI_URL = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"
DEFAULT_SERVICE_ID = "bhashini/bodhan/indic-doc/ocr"
DEFAULT_LANGUAGE = "hi"
DEFAULT_MAX_MB = 5

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

ocr_router = APIRouter(tags=["OCR"])


def get_ocr_settings() -> Dict[str, Any]:
    """Retrieve and validate non-sensitive OCR settings."""
    url = os.getenv("BHASHINI_OCR_URL", DEFAULT_BHASHINI_URL).strip()
    api_key = os.getenv("BHASHINI_INFERENCE_API_KEY", "").strip()
    language = os.getenv("BHASHINI_OCR_LANGUAGE", DEFAULT_LANGUAGE).strip().lower()
    service_id = os.getenv("BHASHINI_OCR_SERVICE_ID", DEFAULT_SERVICE_ID).strip()

    try:
        max_upload_mb = int(os.getenv("MAX_IMAGE_UPLOAD_MB", DEFAULT_MAX_MB))
    except ValueError:
        max_upload_mb = DEFAULT_MAX_MB

    return {
        "url": url,
        "api_key": api_key,
        "language": language,
        "service_id": service_id,
        "max_upload_bytes": max_upload_mb * 1024 * 1024,
        "max_upload_mb": max_upload_mb,
    }


async def call_bhashini_ocr(
    image_bytes: bytes,
    language: str,
    service_id: str,
    api_url: str,
    api_key: str,
    timeout_seconds: float = 60.0,
) -> Dict[str, Any]:
    """Execute OCR request against upstream BHASHINI inference pipeline."""
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    payload = {
        "pipelineTasks": [
            {
                "taskType": "ocr",
                "config": {
                    "serviceId": service_id,
                    "language": {
                        "sourceLanguage": language
                    },
                    "modality": "printed"
                }
            }
        ],
        "inputData": {
            "image": [
                {
                    "imageContent": b64_image
                }
            ]
        }
    }

    headers = {
        "Authorization": api_key,
        "Content-Type": "application/json"
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(api_url, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        logger.error("BHASHINI connection timed out after %s seconds.", timeout_seconds)
        raise HTTPException(
            status_code=504,
            detail="BHASHINI OCR upstream service timed out. Please try again later."
        ) from exc
    except httpx.RequestError as exc:
        logger.error("BHASHINI connection error: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Could not connect to BHASHINI upstream service. Check network connection and endpoint URL."
        ) from exc

    # Sanitize & check status
    status = response.status_code
    if status == 401 or status == 403:
        logger.error("BHASHINI authentication failed (status %d).", status)
        raise HTTPException(
            status_code=502,
            detail="BHASHINI authentication failed. Verify BHASHINI_INFERENCE_API_KEY."
        )

    if status == 422 or status == 400:
        logger.error("BHASHINI validation failure (%d): %s", status, response.text[:300])
        safe_msg = response.text[:300] if len(response.text) < 300 else "Invalid request payload format."
        raise HTTPException(
            status_code=502,
            detail=f"BHASHINI rejected the request ({status}): {safe_msg}"
        )

    if status >= 500:
        logger.error("BHASHINI upstream error (%d): %s", status, response.text[:300])
        raise HTTPException(
            status_code=502,
            detail=f"BHASHINI upstream service failed with HTTP {status}. Check backend logs or try an alternate service ID."
        )

    if status != 200:
        logger.error("BHASHINI unexpected response (%d): %s", status, response.text[:300])
        raise HTTPException(
            status_code=502,
            detail=f"BHASHINI returned unexpected status {status}."
        )

    try:
        return response.json()
    except Exception as exc:
        logger.error("Failed to parse JSON from BHASHINI: %s", str(exc))
        raise HTTPException(
            status_code=502,
            detail="BHASHINI returned an unparseable response."
        ) from exc


def parse_ocr_pipeline_response(
    data: Dict[str, Any],
    language: str,
    service_id: str,
) -> OCRResponse:
    """Parse raw BHASHINI pipelineResponse into standardized OCRResponse schema."""
    pipeline_response = data.get("pipelineResponse", [])
    raw_outputs: List[OCRResultItem] = []
    text_chunks: List[str] = []

    if isinstance(pipeline_response, list):
        for task in pipeline_response:
            if isinstance(task, dict) and task.get("taskType") == "ocr":
                output_list = task.get("output", [])
                if isinstance(output_list, list):
                    for item in output_list:
                        if isinstance(item, dict):
                            src = item.get("source", "").strip()
                            tgt = item.get("target", "")
                            raw_outputs.append(OCRResultItem(source=src, target=tgt))
                            if src:
                                text_chunks.append(src)

    extracted_text = "\n".join(text_chunks)

    return OCRResponse(
        success=True,
        language=language,
        serviceId=service_id,
        extractedText=extracted_text,
        rawOutputs=raw_outputs
    )


@ocr_router.post("/ocr", response_model=OCRResponse)
async def run_ocr(
    file: UploadFile = File(...),
    language: Optional[str] = Query(None, description="Source language code (e.g., 'hi' or 'en')"),
    service_id: Optional[str] = Query(None, description="Optional BHASHINI OCR service ID override"),
):
    """Upload an image of a student document and perform OCR text extraction."""
    settings = get_ocr_settings()

    # 1. Verify credentials configuration
    if not settings["api_key"]:
        logger.error("BHASHINI_INFERENCE_API_KEY is not configured.")
        raise HTTPException(
            status_code=500,
            detail="BHASHINI_INFERENCE_API_KEY is not configured in server environment."
        )

    # 2. Validate MIME type
    content_type = (file.content_type or "").lower()
    filename = (file.filename or "").lower()
    valid_extension = any(filename.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"])

    if not content_type.startswith("image/") and not valid_extension:
        raise HTTPException(
            status_code=400,
            detail=f"Uploaded file must be an image. Received content-type: '{file.content_type}'."
        )

    # 3. Read image bytes safely
    image_bytes = await file.read()

    # 4. Validate non-empty file
    if not image_bytes or len(image_bytes) == 0:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty (0 bytes)."
        )

    # 5. Validate file size limits
    if len(image_bytes) > settings["max_upload_bytes"]:
        raise HTTPException(
            status_code=413,
            detail=f"Image size exceeds the maximum allowed limit of {settings['max_upload_mb']} MB."
        )

    # 6. Resolve language and service ID
    selected_language = (language or settings["language"]).strip().lower()
    selected_service_id = (service_id or settings["service_id"]).strip()

    # 7. Call upstream BHASHINI
    upstream_json = await call_bhashini_ocr(
        image_bytes=image_bytes,
        language=selected_language,
        service_id=selected_service_id,
        api_url=settings["url"],
        api_key=settings["api_key"],
    )

    # 8. Parse and return result
    return parse_ocr_pipeline_response(
        data=upstream_json,
        language=selected_language,
        service_id=selected_service_id,
    )


@ocr_router.post("/documents/parse", response_model=ParsedStudentDocument)
async def upload_and_parse_document(
    file: UploadFile = File(...),
    language: Optional[str] = Query(None, description="Source language code (e.g., 'hi' or 'en')"),
    service_id: Optional[str] = Query(None, description="Optional BHASHINI OCR service ID override"),
):
    """Upload document, perform OCR, and dynamically parse academic fields for human review."""
    # Run OCR first
    ocr_result: OCRResponse = await run_ocr(file=file, language=language, service_id=service_id)
    raw_text = ocr_result.extractedText

    # Re-read file or compute hash
    await file.seek(0)
    image_bytes = await file.read()

    parsed_doc = parse_student_document(
        raw_text=raw_text,
        image_bytes=image_bytes
    )
    return parsed_doc
