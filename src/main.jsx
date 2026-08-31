import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/*
=========================================================
BACKEND CONFIGURATION
=========================================================
*/

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const API_URL = `${API_BASE_URL}/api/scan`;
const HEALTH_URL = `${API_BASE_URL}/api/health`;


/*
=========================================================
ICON COMPONENT
=========================================================
*/

function Icon({ name, size = 20, stroke = 2 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  const icons = {
    shield: (
      <>
        <path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </>
    ),

    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),

    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m21 15-4.5-4.5L7 20" />
      </>
    ),

    check: <path d="m5 12 4 4L19 6" />,

    x: (
      <>
        <path d="m7 7 10 10" />
        <path d="M17 7 7 17" />
      </>
    ),

    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h6" />
      </>
    ),

    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),

    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.9-3" />
        <path d="M4 4v4h4" />
        <path d="M4 13a8 8 0 0 0 14.9 3" />
        <path d="M20 20v-4h-4" />
      </>
    ),

    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </>
    ),

    scan: (
      <>
        <path d="M4 7V5a1 1 0 0 1 1-1h2" />
        <path d="M17 4h2a1 1 0 0 1 1 1v2" />
        <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
        <path d="M7 20H5a1 1 0 0 1-1-1v-2" />
        <path d="M7 12h10" />
        <path d="M12 7v10" />
      </>
    ),

    server: (
      <>
        <rect x="4" y="4" width="16" height="6" rx="1" />
        <rect x="4" y="14" width="16" height="6" rx="1" />
        <path d="M8 7h.01M8 17h.01" />
      </>
    ),

    text: (
      <>
        <path d="M4 6h16" />
        <path d="M4 10h16" />
        <path d="M4 14h10" />
        <path d="M4 18h7" />
      </>
    ),
  };

  return <svg {...common}>{icons[name]}</svg>;
}


/*
=========================================================
LOGO
=========================================================
*/

function Logo() {
  return (
    <div className="brand">

      <div className="brand-mark">
        <Icon name="shield" size={22} />
      </div>

      <div>

        <div className="brand-name">
          MetriCheck
        </div>

        <div className="brand-sub">
          Legal Metrology
        </div>

      </div>

    </div>
  );
}


/*
=========================================================
UPLOAD SCREEN
=========================================================
*/

function UploadScreen({ onResult }) {

  const inputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const [dragging, setDragging] = useState(false);

  const [processing, setProcessing] = useState(false);

  const [progress, setProgress] = useState(0);

  const [error, setError] = useState(null);


  /*
  -------------------------------------------------------
  ACCEPT IMAGE
  -------------------------------------------------------
  */

  const acceptFile = (selectedFile) => {

    if (!selectedFile) {
      return;
    }


    if (!selectedFile.type.startsWith("image/")) {

      setError(
        "Please select a valid image file."
      );

      return;
    }


    setError(null);

    setFile(selectedFile);


    const imageURL =
      URL.createObjectURL(selectedFile);

    setPreview(imageURL);
  };


  /*
  -------------------------------------------------------
  DROP HANDLER
  -------------------------------------------------------
  */

  const handleDrop = (event) => {

    event.preventDefault();

    setDragging(false);

    const droppedFile =
      event.dataTransfer.files?.[0];

    acceptFile(droppedFile);
  };


  /*
  -------------------------------------------------------
  SEND IMAGE TO FLASK BACKEND
  -------------------------------------------------------
  */

const handleComplianceCheck = async () => {

    if (!file) {
      setError("Please upload a product image first.");
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {

      setProcessing(true);
      setProgress(5);
      setError(null);

      // Check the Flask service first so connection errors are explicit.
      setProgress(10);
      const healthResponse = await fetch(HEALTH_URL, {
        method: "GET",
        signal: controller.signal,
      });

      if (!healthResponse.ok) {
        throw new Error(`Compliance backend is unavailable (HTTP ${healthResponse.status}).`);
      }

      const healthData = await healthResponse.json();
      if (!healthData.success) {
        throw new Error("Compliance backend health check failed.");
      }

      setProgress(18);

      const formData = new FormData();
      formData.append("image", file);

      console.log("Sending image to backend:", {
        name: file.name,
        size: file.size,
        type: file.type,
      });

      const response = await fetch(API_URL, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      setProgress(80);

      const rawResponse = await response.text();
      console.log("Backend HTTP status:", response.status);
      console.log("Backend raw response:", rawResponse);

      let data;
      try {
        data = JSON.parse(rawResponse);
      } catch {
        throw new Error("The backend returned an invalid response. Check the Flask terminal for the actual error.");
      }

      if (!response.ok || data.success === false) {
        throw new Error(data.error || `Backend returned HTTP ${response.status}.`);
      }

      if (!Array.isArray(data.checks)) {
        throw new Error("Backend response is missing the checks array.");
      }

      setProgress(100);

      onResult({
        imageUrl: preview,
        fileName: file.name,
        checks: data.checks,
        backendResponse: data,
      });

    } catch (error) {

      console.error("SCAN FAILED:", error);

      if (error.name === "AbortError") {
        setError("The scan timed out. EasyOCR can take a while on the first run; make sure the Flask terminal is still running.");
      } else if (error instanceof TypeError && /fetch/i.test(error.message)) {
        setError("Cannot reach the Flask backend. Start backend/index.py and make sure it is running on port 5000.");
      } else {
        setError(error.message || "Unable to complete the image scan.");
      }

      setProgress(0);

    } finally {

      clearTimeout(timeout);
      setProcessing(false);
    }
  };


  /*
  =======================================================
  UI
  =======================================================
  */

  return (

    <main className="screen upload-screen">


      {/* PAGE HEADER */}

      <div className="page-heading">

        <div>

          <div className="eyebrow">

            <Icon
              name="scan"
              size={15}
            />

            COMPLIANCE SCANNER

          </div>


          <h1>
            Check a packaged commodity
          </h1>


          <p>
            Upload a clear package photograph.
            MetriCheck will send the image to the
            compliance engine for OCR, barcode and
            rule-based analysis.
          </p>

        </div>


        <div className="rules-pill">

          <span></span>

          Rules: 2011

        </div>

      </div>



      {/* UPLOAD GRID */}

      <section className="upload-grid">


        {/* UPLOAD CARD */}

        <div className="card upload-card">


          <div className="card-title">

            <div className="title-icon">

              <Icon
                name="upload"
              />

            </div>


            <div>

              <h2>
                Product image
              </h2>

              <p>
                Drag & drop your package photo here
              </p>

            </div>

          </div>



          {/* DROPZONE */}

          <div

            className={
              "dropzone " +
              (dragging
                ? "dragging "
                : "") +
              (file
                ? "has-file"
                : "")
            }


            onDragOver={(event) => {

              event.preventDefault();

              setDragging(true);

            }}


            onDragLeave={() => {

              setDragging(false);

            }}


            onDrop={handleDrop}


            onClick={() => {

              if (!processing) {

                inputRef.current?.click();

              }

            }}

          >


            <input

              ref={inputRef}

              type="file"

              accept="image/*"

              hidden


              onChange={(event) => {

                acceptFile(
                  event.target.files?.[0]
                );

              }}

            />


            {preview ? (

              <>

                <img

                  className="upload-preview"

                  src={preview}

                  alt="Selected product"

                />


                <div className="preview-overlay">

                  <span>

                    <Icon
                      name="refresh"
                      size={16}
                    />

                    Change image

                  </span>

                </div>

              </>

            ) : (

              <>

                <div className="upload-icon">

                  <Icon
                    name="image"
                    size={31}
                  />

                </div>


                <strong>
                  Drop image here
                </strong>


                <span>
                  or click to browse from your device
                </span>


                <small>
                  JPG, PNG, WEBP • Clear label recommended
                </small>

              </>

            )}

          </div>



          {/* FILE INFORMATION */}

          {file && (

            <div className="file-row">


              <div className="file-type">

                <Icon
                  name="image"
                  size={17}
                />

              </div>


              <div className="file-meta">

                <strong>
                  {file.name}
                </strong>


                <span>

                  {(file.size / 1024 / 1024)
                    .toFixed(2)}

                  {" MB"}

                </span>

              </div>


              <button

                className="text-btn"

                disabled={processing}


                onClick={(event) => {

                  event.stopPropagation();

                  setFile(null);

                  setPreview(null);

                  setError(null);

                  setProgress(0);

                }}

              >

                Remove

              </button>

            </div>

          )}



          {/* ERROR */}

          {error && (

            <div className="upload-error">

              <Icon
                name="x"
                size={15}
              />

              {error}

            </div>

          )}



          {/* PROCESSING */}

          {processing && (

            <div className="ocr-progress">


              <div className="ocr-progress-header">

                <span>

                  Sending image to compliance engine...

                </span>


                <strong>
                  {progress}%
                </strong>

              </div>


              <div className="progress-track">

                <div

                  className="progress-fill"

                  style={{
                    width:
                      `${progress}%`,
                  }}

                />

              </div>


              <small>

                Flask + EasyOCR + barcode
                detection + rule engine

              </small>

            </div>

          )}



          {/* CHECK BUTTON */}

          <button

            className="primary-btn full"

            disabled={processing}

            onClick={handleComplianceCheck}

          >

            {processing ? (

              <>

                <span className="spinner"></span>

                Analyzing image...

              </>

            ) : (

              <>

                <Icon
                  name="scan"
                  size={18}
                />

                Check Compliance

                <Icon
                  name="arrow"
                  size={17}
                />

              </>

            )}

          </button>



          {/* BACKEND STATUS */}

          <div className="privacy-note">

            <Icon
              name="server"
              size={15}
            />

            Analysis is performed by the local Flask compliance backend

          </div>

        </div>



        {/* GUIDANCE CARD */}

        <aside className="card guidance-card">


          <div className="guidance-head">

            <div className="title-icon soft">

              <Icon
                name="shield"
              />

            </div>


            <div>

              <h2>
                For best results
              </h2>


              <p>
                Capture declarations clearly
              </p>

            </div>

          </div>



          <div className="guidance-list">


            <div>

              <span className="number">
                01
              </span>


              <div>

                <strong>
                  Keep the label flat
                </strong>


                <p>
                  Avoid folds, glare and shadows.
                </p>

              </div>

            </div>



            <div>

              <span className="number">
                02
              </span>


              <div>

                <strong>
                  Use good lighting
                </strong>


                <p>
                  Make small text readable.
                </p>

              </div>

            </div>



            <div>

              <span className="number">
                03
              </span>


              <div>

                <strong>
                  Show the full package
                </strong>


                <p>
                  Include the declaration panels.
                </p>

              </div>

            </div>


          </div>



          <div className="legal-note">

            <Icon
              name="info"
              size={16}
            />


            <span>

              The image is analyzed by the
              Flask backend using EasyOCR,
              barcode detection and rule-based
              validation.

            </span>

          </div>

        </aside>

      </section>

    </main>
  );
}


/*
=========================================================
RESULT STATUS ICON
=========================================================
*/

function ResultStatus({ status }) {

  const normalized = String(status || "").toLowerCase();

  if (normalized === "pass") {
    return (
      <span className="status-icon pass">
        <Icon name="check" size={15} stroke={2.6} />
      </span>
    );
  }

  if (normalized === "unavailable") {
    return (
      <span className="status-icon unavailable">
        <Icon name="info" size={15} stroke={2.2} />
      </span>
    );
  }

  return (
    <span className="status-icon fail">
      <Icon name="x" size={15} stroke={2.6} />
    </span>
  );
}


/*
=========================================================
RESULTS SCREEN
=========================================================
*/

function ResultsScreen({
  result,
  onBack,
}) {

  const checks =
    Array.isArray(result?.checks)
      ? result.checks
      : [];


  /*
  -------------------------------------------------------
  CALCULATE SUMMARY
  -------------------------------------------------------
  */

  const passed =
    checks.filter(
      (check) =>
        String(check.status).toLowerCase() ===
        "pass"
    ).length;


  const failed = checks.filter(
    (check) => String(check.status).toLowerCase() === "fail"
  ).length;

  const unavailable = checks.filter(
    (check) => String(check.status).toLowerCase() === "unavailable"
  ).length;

  const evaluated = passed + failed;

  const isCompliant =
    evaluated > 0 &&
    failed === 0;

  const verdict =
    evaluated === 0
      ? "REVIEW REQUIRED"
      : isCompliant
        ? "COMPLIANT"
        : "NON-COMPLIANT";



  /*
  -------------------------------------------------------
  DOWNLOAD BACKEND RESPONSE
  -------------------------------------------------------
  */

  const downloadReport = () => {

    const report = {

      scanId:
        "LM-" +
        Date.now(),

      image:
        result.fileName,

      verdict:
        isCompliant
          ? "COMPLIANT"
          : "NON-COMPLIANT",

      checks:
        checks,

      backendResponse:
        result.backendResponse,

    };


    const blob =
      new Blob(

        [
          JSON.stringify(
            report,
            null,
            2
          ),
        ],

        {
          type:
            "application/json",
        }

      );


    const url =
      URL.createObjectURL(blob);


    const link =
      document.createElement("a");


    link.href = url;


    link.download =
      "MetriCheck-Compliance-Report.json";


    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);


    URL.revokeObjectURL(url);

  };



  return (

    <main className="screen results-screen">


      {/* RESULT HEADER */}

      <div className="result-topbar">


        <div>

          <div className="eyebrow">

            <Icon
              name="check"
              size={15}
            />

            COMPLIANCE RESULT

          </div>


          <h1>
            Inspection result
          </h1>


          <p>

            The uploaded package image was
            analyzed by the Flask compliance
            backend.

          </p>

        </div>



        <div className="result-actions">


          <button

            className="secondary-btn"

            onClick={onBack}

          >

            <Icon
              name="refresh"
              size={16}
            />

            New scan

          </button>



          <button

            className="report-btn"

            onClick={downloadReport}

          >

            <Icon
              name="file"
              size={17}
            />

            Download Report

          </button>


        </div>

      </div>



      {/* VERDICT BANNER */}

      <div

        className={
          "verdict-banner " +
          (failed > 0
            ? "bad"
            : evaluated === 0
              ? "review"
              : "good")
        }

      >


        <div className="verdict-symbol">

          <Icon

            name={
              failed > 0
                ? "x"
                : evaluated === 0
                  ? "info"
                  : "check"
            }

            size={25}

            stroke={2.5}

          />

        </div>



        <div>

          <span>
            OVERALL VERDICT
          </span>


          <strong>

            {verdict}

          </strong>


          <p>

            {failed > 0
              ? `${failed} check${failed > 1 ? "s" : ""} require attention.`
              : evaluated === 0
                ? "No checks could be evaluated from the returned image data."
                : unavailable > 0
                  ? "All evaluated checks passed; some measurements were unavailable."
                  : "All backend checks passed."}

          </p>

        </div>



        <div className="verdict-count">

          <strong>

            {passed}/{"8"}

          </strong>


          <span>
            checks passed
            {unavailable > 0 ? ` • ${unavailable} unavailable` : ""}
          </span>

        </div>

      </div>



      {/* RESULTS GRID */}

      <section className="results-grid">


        {/* =================================================
            IMAGE
        ================================================= */}

        <div className="card photo-card">


          <div className="section-heading">


            <div>

              <h2>
                Packet photo
              </h2>


              <p>
                Image sent to the backend
              </p>

            </div>


            <span className="photo-badge">

              <Icon
                name="image"
                size={14}
              />

              SOURCE

            </span>

          </div>



          <div className="evidence-frame">

            {result.imageUrl ? (

              <img

                className="packet-photo"

                src={result.imageUrl}

                alt="Scanned package"

              />

            ) : (

              <div className="no-image">

                <Icon
                  name="image"
                  size={35}
                />

                <span>
                  Image unavailable
                </span>

              </div>

            )}

          </div>



          <div className="evidence-caption">


            <div>

              <span>
                File
              </span>


              <strong>
                {result.fileName}
              </strong>

            </div>



            <div>

              <span>
                Engine
              </span>


              <strong>
                EasyOCR + OpenCV
              </strong>

            </div>

          </div>

        </div>



        {/* =================================================
            CHECKLIST
        ================================================= */}

        <div className="card checklist-card">


          <div className="section-heading">


            <div>

              <h2>
                Declaration checklist
              </h2>


              <p>
                Results returned by index.py
              </p>

            </div>



            <span className="check-summary">


              <span className="mini-pass">

                {passed} pass

              </span>


              <span className="mini-fail">

                {failed} fail

              </span>


            </span>

          </div>



          <div className="checklist">


            {checks.length === 0 ? (

              <div className="empty-checks">

                <Icon
                  name="info"
                  size={20}
                />

                No compliance checks were
                returned by the backend.

              </div>

            ) : (

              checks.map(
                (item, index) => (

                  <div

                    className={
                      `check-item ${String(item.status).toLowerCase()}`
                    }

                    key={
                      item.field ||
                      index
                    }

                  >


                    <ResultStatus

                      status={
                        item.status
                      }

                    />



                    <div className="check-content">


                      <div className="field-name">

                        {item.field}

                      </div>



                      {String(
                        item.status
                      ).toLowerCase() ===
                      "pass" ? (

                        <div className="field-value">

                          {item.value ||
                            "Detected"}

                        </div>

                      ) : (

                        <div className="field-error">

                          {item.value ||
                            "MISSING"}

                        </div>

                      )}

                    </div>



                    <span className="row-number">

                      {String(
                        index + 1
                      ).padStart(2, "0")}

                    </span>

                  </div>

                )
              )

            )}

          </div>



          {/* =================================================
              BACKEND RESPONSE
          ================================================= */}

          <details className="ocr-details">


            <summary>

              <Icon
                name="server"
                size={15}
              />

              View backend response

            </summary>



            <pre>

              {JSON.stringify(
                result.backendResponse,
                null,
                2
              )}

            </pre>


          </details>



          <div className="disclaimer">

            <Icon
              name="info"
              size={15}
            />

            These values are returned directly
            by the Flask compliance engine.

          </div>

        </div>

      </section>

    </main>
  );
}


/*
=========================================================
APP
=========================================================
*/

function App() {

  const [screen, setScreen] =
    useState("upload");


  const [result, setResult] =
    useState(null);


  const handleResult = (
    backendResult
  ) => {

    setResult(
      backendResult
    );

    setScreen(
      "results"
    );

  };


  return (

    <div className="app">


      {/* =================================================
          HEADER
      ================================================= */}

      <header className="top-nav">


        <Logo />


        <div className="stepper">


          <div

            className={
              "step active " +
              (
                screen ===
                "results"
                  ? "done"
                  : ""
              )
            }

          >

            <span>

              {screen ===
              "results"
                ? "✓"
                : "1"}

            </span>

            Upload

          </div>



          <div className="step-line"></div>



          <div

            className={
              "step " +
              (
                screen ===
                "results"
                  ? "active"
                  : ""
              )
            }

          >

            <span>
              2
            </span>

            Results

          </div>

        </div>



        <div className="prototype-label">

          FLASK + OCR

        </div>

      </header>



      {/* =================================================
          SCREENS
      ================================================= */}

      {screen === "upload" ? (

        <UploadScreen

          onResult={
            handleResult
          }

        />

      ) : (

        <ResultsScreen

          result={
            result
          }

          onBack={() =>
            setScreen(
              "upload"
            )
          }

        />

      )}



      {/* =================================================
          FOOTER
      ================================================= */}

      <footer className="footer">


        <span>

          Legal Metrology
          (Packaged Commodities)
          Rules, 2011

        </span>


        <span>

          SIH26034 •
          Flask + EasyOCR Prototype

        </span>


      </footer>

    </div>
  );
}


/*
=========================================================
START REACT
=========================================================
*/

createRoot(
  document.getElementById("root")
).render(
  <App />
);
