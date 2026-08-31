from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

import cv2
import easyocr
import numpy as np
import os
import re
import tempfile
import traceback


app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"}
MAX_FILE_SIZE = 15 * 1024 * 1024

print("Loading EasyOCR... This can take a little while on first start.")
reader = easyocr.Reader(["en"], gpu=False, verbose=False)
print("EasyOCR loaded successfully.")


def allowed_file(filename):
    return (
        bool(filename)
        and "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def clean_spaces(text):
    return re.sub(r"\s+", " ", text or "").strip()


def normalize_ocr_text(text):
    text = text or ""
    text = text.replace("₹", " Rs. ")
    text = re.sub(r"\bHRP\b", "MRP", text, flags=re.IGNORECASE)
    text = re.sub(r"\bMR[Pp]\b", "MRP", text, flags=re.IGNORECASE)
    return clean_spaces(text)


def canonical_text(texts):
    lines = []
    seen = set()
    for text in texts:
        text = normalize_ocr_text(text)
        if not text:
            continue
        key = re.sub(r"[^a-z0-9]+", "", text.lower())
        if key and key not in seen:
            seen.add(key)
            lines.append(text)
    return " ".join(lines)


def detect_ean13(image):
    """Try OpenCV's barcode detector without making it a hard dependency."""
    if not hasattr(cv2, "barcode"):
        return None, None, None

    try:
        detector = cv2.barcode.BarcodeDetector()

        if hasattr(detector, "detectAndDecodeWithType"):
            retval, decoded_info, decoded_type, points = detector.detectAndDecodeWithType(image)
            if retval and decoded_info is not None:
                for i, value in enumerate(decoded_info):
                    digits = re.sub(r"\D", "", str(value).strip())
                    if len(digits) == 13:
                        pts = None
                        if points is not None and i < len(points):
                            try:
                                pts = np.asarray(points[i]).reshape(-1, 2)
                            except Exception:
                                pts = None
                        height = None
                        if pts is not None and len(pts) >= 4:
                            height = float(np.max(pts[:, 1]) - np.min(pts[:, 1]))
                        return digits, height, pts

        if hasattr(detector, "detectAndDecodeMulti"):
            ok, decoded_info, points, _ = detector.detectAndDecodeMulti(image)
            if ok and decoded_info is not None:
                for i, value in enumerate(decoded_info):
                    digits = re.sub(r"\D", "", str(value).strip())
                    if len(digits) == 13:
                        pts = None
                        if points is not None and i < len(points):
                            try:
                                pts = np.asarray(points[i]).reshape(-1, 2)
                            except Exception:
                                pts = None
                        height = None
                        if pts is not None and len(pts) >= 4:
                            height = float(np.max(pts[:, 1]) - np.min(pts[:, 1]))
                        return digits, height, pts
    except Exception as exc:
        print("Barcode detection warning:", exc)

    return None, None, None


def prepare_ocr_images(image):
    """Return a small set of useful OCR variants; no fake data is introduced."""
    variants = [("original", image)]

    h, w = image.shape[:2]
    scale = 2.0 if max(h, w) < 1800 else 1.5
    up = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
    gray = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    contrast = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)

    variants.append(("enhanced", contrast))
    variants.append(("threshold", cv2.threshold(contrast, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]))
    return variants


def run_ocr(image):
    detections = []
    variants = prepare_ocr_images(image)

    for variant_name, variant in variants:
        try:
            result = reader.readtext(
                variant,
                detail=1,
                paragraph=False,
                mag_ratio=1.0,
                text_threshold=0.55,
                low_text=0.30,
                link_threshold=0.30,
                width_ths=0.7,
                ycenter_ths=0.5,
            )
        except Exception as exc:
            print(f"OCR warning ({variant_name}):", exc)
            continue

        for box, text, confidence in result:
            text = clean_spaces(text)
            if not text:
                continue
            detections.append({
                "text": text,
                "confidence": float(confidence),
                "box": np.asarray(box).tolist(),
                "variant": variant_name,
            })

    # Prefer higher-confidence detections and deduplicate similar OCR strings.
    detections.sort(key=lambda x: x["confidence"], reverse=True)
    unique = []
    seen = set()
    for item in detections:
        key = re.sub(r"[^a-z0-9]+", "", item["text"].lower())
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(item)

    return unique


def extract_mrp(text):
    patterns = [
        r"\bM\.?\s*R\.?\s*P\.?\s*(?:Rs\.?|INR)?\s*[:\-]?\s*(\d+(?:[.,]\d{1,2})?)",
        r"\bRs\.?\s*[:\-]?\s*(\d+(?:[.,]\d{1,2})?)",
        r"₹\s*(\d+(?:[.,]\d{1,2})?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            amount = match.group(1).replace(",", ".")
            if "." not in amount:
                amount = f"{amount}.00"
            elif len(amount.split(".", 1)[1]) == 1:
                amount += "0"
            return f"Rs. {amount}"
    return None


def extract_quantity(text):
    unit = r"(?:kg|kgs|g|gm|gms|mg|ml|l|ltr|litre|liter|pcs|pieces)"
    patterns = [
        rf"\bNet\s*(?:Quantity|Qty|Weight|Wt)\.?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*({unit})\b",
        rf"\bNet\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*({unit})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return f"{match.group(1)} {match.group(2)}"
    return None

def extract_net_weight(text):
    """
    Extracts Net Weight / Net Wt declarations.

    Examples detected:
        Net Weight: 500 g
        Net Wt. 500g
        Net Wt 0.5 kg
        Net Weight - 1 kg
        Net Wt: 250 gm
        Net Weight: 500 ml
    """

    patterns = [
        r'\bNet\s+(?:Weight|Wt|Wt\.)\s*[:\-]?\s*'
        r'(\d+(?:\.\d+)?)\s*'
        r'(kg|kgs|g|gm|gms|mg|lb|lbs)\b',

        r'\bNet\s*Wt\.?\s*[:\-]?\s*'
        r'(\d+(?:\.\d+)?)\s*'
        r'(kg|kgs|g|gm|gms|mg|lb|lbs)\b',

        r'\bNet\s*Weight\s*[:\-]?\s*'
        r'(\d+(?:\.\d+)?)\s*'
        r'(kg|kgs|g|gm|gms|mg|lb|lbs)\b',
    ]

    for pattern in patterns:

        match = re.search(
            pattern,
            text,
            re.IGNORECASE
        )

        if match:
            value = match.group(1)
            unit = match.group(2)

            return f"{value} {unit}"

    return None


def extract_manufacturer(text):
    patterns = [
        r"\bManufactured\s+By\s*[:\-]?\s*(.+?)(?=\s+(?:Net|MRP|Batch|Packed|Pack|Month|Date|Mfg|Mfd|Consumer|Country|FSSAI|$))",
        r"\bManufactured\s*(?:at|by)\s*[:\-]?\s*(.+?)(?=\s+(?:Net|MRP|Batch|Packed|Pack|Month|Date|Consumer|Country|FSSAI|$))",
        r"\b(?:Mfd|Mfg)\.?\s*By\s*[:\-]?\s*(.+?)(?=\s+(?:Net|MRP|Batch|Packed|Pack|Month|Date|Consumer|Country|FSSAI|$))",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = clean_spaces(match.group(1)).strip(" ,.;:")
            if len(value) >= 3:
                return value
    return None


def extract_month_year(text):
    patterns = [
        r"\b(0?[1-9]|1[0-2])\s*[/\-]\s*(20\d{2})\b",
        r"\b(0?[1-9]|1[0-2])\s+(20\d{2})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return f"{match.group(1)}/{match.group(2)}"
    return None


def extract_consumer_care(text):
    patterns = [
        r"\b(?:Consumer|Customer)\s*Care\s*[:\-]?\s*(.+?)(?=\s+(?:Country|Made|MRP|Net|Batch|FSSAI|$))",
        r"\bCustomer\s*Service\s*[:\-]?\s*(.+?)(?=\s+(?:Country|Made|MRP|Net|Batch|FSSAI|$))",
        r"\bHelpline\s*[:\-]?\s*(.+?)(?=\s+(?:Country|Made|MRP|Net|Batch|FSSAI|$))",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = clean_spaces(match.group(1)).strip(" ,.;:")
            if value:
                return value
    return None


def extract_country(text):
    patterns = [
        r"\bCountry\s+of\s+Origin\s*[:\-]?\s*(.+?)(?=\s+(?:MRP|Net|Batch|Consumer|FSSAI|$))",
        r"\bMade\s+in\s+([A-Za-z][A-Za-z .'-]{1,40})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = clean_spaces(match.group(1)).strip(" ,.;:")
            if value:
                return value
    return None


def estimate_font_height(ocr_detections, barcode_px_height):
    """Estimate text height only when a barcode scale is available.

    This is an image-based prototype estimate, not a legal metrology measurement.
    """
    if not barcode_px_height or barcode_px_height <= 0 or not ocr_detections:
        return None

    # Use the median of several reasonably confident OCR boxes instead of one box.
    heights = []
    for item in ocr_detections:
        if item["confidence"] < 0.45:
            continue
        pts = np.asarray(item["box"], dtype=float)
        if pts.shape[0] >= 4:
            h1 = np.linalg.norm(pts[0] - pts[3])
            h2 = np.linalg.norm(pts[1] - pts[2])
            height = (h1 + h2) / 2.0
            if height > 0:
                heights.append(height)

    if not heights:
        return None

    text_px_height = float(np.median(heights))
    mm_per_px = 25.93 / float(barcode_px_height)
    return text_px_height * mm_per_px


@app.get("/api/health")
def health():
    return jsonify({
        "success": True,
        "service": "MetriCheck compliance backend",
        "ocr": "EasyOCR",
        "barcode": bool(hasattr(cv2, "barcode")),
    })


@app.post("/api/scan")
def scan_label():
    temp_path = None

    try:
        if "image" not in request.files:
            return jsonify({"success": False, "error": "No image uploaded."}), 400

        file = request.files["image"]
        filename = secure_filename(file.filename or "")

        if not filename:
            return jsonify({"success": False, "error": "No image selected."}), 400

        if not allowed_file(filename):
            return jsonify({
                "success": False,
                "error": "Unsupported image type. Use JPG, PNG, WEBP, BMP, TIF or TIFF."
            }), 400

        content_length = request.content_length or 0
        if content_length > MAX_FILE_SIZE:
            return jsonify({
                "success": False,
                "error": "Image is too large. Maximum allowed size is 15 MB."
            }), 413

        suffix = os.path.splitext(filename)[1].lower() or ".jpg"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            file.save(temp_path)

        image = cv2.imread(temp_path)
        if image is None:
            return jsonify({
                "success": False,
                "error": "The uploaded file could not be decoded as an image."
            }), 400

        print("\n========================================")
        print("NEW IMAGE RECEIVED")
        print("Filename:", filename)
        print("Image size:", image.shape)
        print("========================================")

        barcode_value, barcode_px_height, _ = detect_ean13(image)
        print("Barcode:", barcode_value or "not detected")

        print("Running EasyOCR...")
        detections = run_ocr(image)
        print("OCR unique blocks:", len(detections))

        for item in detections:
            print(f"OCR: {item['text']} (confidence={item['confidence']:.2f})")

        ocr_text = canonical_text([item["text"] for item in detections])
        print("\n========== OCR TEXT ==========")
        print(ocr_text or "No readable text detected")
        print("================================\n")

        mrp = extract_mrp(ocr_text)
        quantity = extract_quantity(ocr_text)
        net_weight = extract_net_weight(ocr_text)
        manufacturer = extract_manufacturer(ocr_text)
        month_year = extract_month_year(ocr_text)
        consumer_care = extract_consumer_care(ocr_text)
        country = extract_country(ocr_text)

        estimated_font_mm = estimate_font_height(detections, barcode_px_height)
        if estimated_font_mm is not None:
            font_status = "pass" if estimated_font_mm >= 1.0 else "fail"
            font_value = f"{estimated_font_mm:.2f} mm (estimated)"
        else:
            font_status = "unavailable"
            font_value = "Unable to estimate from image"

        checks = [
            {
                "field": "MRP",
                "status": "pass" if mrp else "fail",
                "value": mrp or "MISSING",
            },
            {
                "field": "Net quantity",
                "status": "pass" if quantity else "fail",
                "value": quantity or "MISSING",
            },
            {
                "field": "Net weight",
                "status":
                "pass"
                if net_weight
                else "fail",

                "value":
                net_weight
                if net_weight
                else "MISSING"
            },
            {
                "field": "Manufacturer",
                "status": "pass" if manufacturer else "fail",
                "value": manufacturer or "MISSING",
            },
            {
                "field": "Month & year of packing",
                "status": "pass" if month_year else "fail",
                "value": month_year or "MISSING",
            },
            {
                "field": "Consumer care",
                "status": "pass" if consumer_care else "fail",
                "value": consumer_care or "MISSING",
            },
            {
                "field": "Country of origin",
                "status": "pass" if country else "fail",
                "value": country or "MISSING",
            },
            {
                "field": "Font Size (1mm Rule)",
                "status": font_status,
                "value": font_value,
            },
        ]

        response = {
            "success": True,
            "checks": checks,
            "barcode": {
                "detected": barcode_value is not None,
                "value": barcode_value,
                "reference_height_px": barcode_px_height,
            },
            "ocr": {
                "text": ocr_text,
                "blocks": len(detections),
                "detections": detections,
            },
            "metadata": {
                "filename": filename,
                "image_width": int(image.shape[1]),
                "image_height": int(image.shape[0]),
                "font_measurement": "estimated from image scale; not a legal measurement",
            },
        }

        print("========== FINAL RESULT ==========")
        for check in checks:
            print(f"{check['field']} => {check['status']} => {check['value']}")
        print("===================================\n")

        return jsonify(response)

    except Exception as exc:
        print("\n!!!!!!!! BACKEND ERROR !!!!!!!!")
        traceback.print_exc()
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n")
        return jsonify({
            "success": False,
            "error": f"Scan failed: {exc.__class__.__name__}: {exc}",
        }), 500

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


if __name__ == "__main__":
    print("\n========================================")
    print("MetriCheck backend starting...")
    print("API: http://localhost:5000/api/scan")
    print("Health: http://localhost:5000/api/health")
    print("========================================\n")
    app.run(host="127.0.0.1", port=5000, debug=True)
