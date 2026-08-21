import { useEffect, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { auth, firestore } from "./firebase";

const HF_PREDICT_URL = "https://AbdulraufIbrahim-plant-disease-api.hf.space/predict";

// ────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ────────────────────────────────────────────────────────
function readImageAsDataUrl(file, maxWidth = 400, quality = 0.6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      const scaleSize = Math.min(1, maxWidth / img.width);

      canvas.width = Math.round(img.width * scaleSize);
      canvas.height = Math.round(img.height * scaleSize);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to read image."));
    };

    img.src = objectUrl;
  });
}

function getDisplayImageSrc(imageValue) {
  if (typeof imageValue !== "string" || !imageValue.trim()) return "";
  if (imageValue.startsWith("data:image")) return imageValue;
  if (imageValue.startsWith("http://") || imageValue.startsWith("https://")) {
    return imageValue;
  }
  return "data:image/jpeg;base64," + imageValue;
}

function getEventTimeMs(event) {
  if (typeof event?.createdAt?.toMillis === "function") return event.createdAt.toMillis();
  if (typeof event?.createdAt?.seconds === "number") return event.createdAt.seconds * 1000;
  if (typeof event?.timestampEpoch === "number") return event.timestampEpoch * 1000;
  if (typeof event?.lastSeenEpoch === "number") return event.lastSeenEpoch * 1000;
  if (!event?.timestamp) return 0;
  const parsed = Date.parse(String(event.timestamp).replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toSortedEventList(data) {
  const events = Array.isArray(data) ? data : Object.values(data || {});

  return events
    .filter((event) => event && typeof event === "object")
    .sort((a, b) => getEventTimeMs(b) - getEventTimeMs(a));
}

function formatConfidence(confidence) {
  const value = Number(confidence);
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "0.00%";
}

// ────────────────────────────────────────────────────────
// SVG ICON COMPONENTS
// ────────────────────────────────────────────────────────
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4l3 3" />
      <path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// Dark Mode Moon Icon
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function LogOutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function UploadIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.52z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.44l-3.24-2.51c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.41 13.88A6 6 0 0 1 6.09 12c0-.65.11-1.28.32-1.88V7.53H3.06A10 10 0 0 0 2 12c0 1.61.39 3.14 1.06 4.47l3.35-2.59z" />
      <path fill="#EA4335" d="M12 6c1.47 0 2.8.51 3.84 1.51l2.87-2.87C16.97 3.02 14.7 2 12 2a10 10 0 0 0-8.94 5.53l3.35 2.59C7.2 7.76 9.4 6 12 6z" />
    </svg>
  );
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [googleSigningIn, setGoogleSigningIn] = useState(false);

  // ── Data state ───────────────────────────────
  const [diseaseHistory, setDiseaseHistory] = useState([]);
  const [imagePreview, setImagePreview] = useState(null);

  // ── Pagination state ──────────────────────────
  const [diseasePage, setDiseasePage] = useState(0);

  // ── Theme / Nav state ─────────────────────────
  const [darkMode, setDarkMode] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Toast Alert state ─────────────────────────
  const [toasts, setToasts] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);

  // ── Drag & drop upload state ──────────────────
  const [dragActive, setDragActive] = useState(false);

  // ── Browser Camera State ──────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [videoStream, setVideoStream] = useState(null);
  const videoRef = useRef(null);

  // ── Loading flags ─────────────────────────────
  const [loadingPlantUpload, setLoadingPlantUpload] = useState(false);
  const authBusy = signingIn || googleSigningIn;

  const plantFileInputRef = useRef(null);

  useEffect(() => {
    document.body.setAttribute("data-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Auth handler
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setCheckingAuth(false);
    });
    return unsubscribe;
  }, []);

  // Firestore History Listener
  useEffect(() => {
    if (!user) {
      const clearHistoryTimer = window.setTimeout(() => {
        setDiseaseHistory([]);
      }, 0);
      return () => window.clearTimeout(clearHistoryTimer);
    }

    const diseaseHistoryQuery = query(
      collection(firestore, "users", user.uid, "diseaseHistory"),
      orderBy("createdAt", "desc"),
    );

    const unsubscribeDiseaseHistory = onSnapshot(
      diseaseHistoryQuery,
      (snapshot) => {
        const events = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        setDiseaseHistory(toSortedEventList(events));
      },
      (err) => {
        console.error("Firestore history listener failed:", err);
        setDiseaseHistory([]);
      },
    );

    return () => {
      unsubscribeDiseaseHistory();
    };
  }, [user]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (videoStream) {
        videoStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [videoStream]);

  // Toast Helpers
  const addToast = (message, type = "info") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    setAuthError("");
    setSigningIn(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword("");
      addToast("Successfully authenticated", "success");
    } catch (err) {
      console.error("Sign in failed:", err);
      setAuthError("Sign in failed. Check the email and password, then try again.");
      addToast("Sign in failed", "error");
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError("");
    setGoogleSigningIn(true);

    try {
      await signInWithPopup(auth, googleProvider);
      addToast("Successfully authenticated with Google", "success");
    } catch (err) {
      console.error("Google sign in failed:", err);
      setAuthError("Google sign in failed. Please try again.");
      addToast("Google sign in failed", "error");
    } finally {
      setGoogleSigningIn(false);
    }
  };

  // Upload crop logic
  const handlePlantFile = async (file) => {
    if (!file) return;

    if (!user) {
      addToast("Please sign in before running a crop scan.", "error");
      return;
    }

    if (file.type && !file.type.startsWith("image/")) {
      addToast("Please upload an image file for diagnosis.", "error");
      return;
    }

    setLoadingPlantUpload(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "plant.jpg");

      const response = await fetch(HF_PREDICT_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Agroguard service returned HTTP ${response.status}`);
      }

      const result = await response.json();
      const scannedAt = new Date();
      const timestamp = scannedAt.toISOString().replace("T", " ").slice(0, 19);
      const timestampEpoch = Math.floor(scannedAt.getTime() / 1000);
      const imageUrl = await readImageAsDataUrl(file);
      const diseaseEvent = {
        label: result.label || "unknown",
        confidence: Number(result.confidence || 0),
        source: file.name === "camera-snap.jpg" ? "camera capture" : "dashboard upload",
        timestamp,
        timestampEpoch,
        imageUrl,
      };
      const firestoreDiseaseEvent = {
        ...diseaseEvent,
        userId: user.uid,
        userEmail: user.email || null,
        createdAt: serverTimestamp(),
      };

      const historyDoc = doc(collection(firestore, "users", user.uid, "diseaseHistory"));
      const latestDoc = doc(firestore, "users", user.uid, "disease", "latest");
      const batch = writeBatch(firestore);

      batch.set(historyDoc, firestoreDiseaseEvent);
      batch.set(
        latestDoc,
        {
          ...firestoreDiseaseEvent,
          historyId: historyDoc.id,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      await batch.commit();

      setAnalysisResult({ id: historyDoc.id, ...diseaseEvent });
      addToast("Diagnosis saved to Firestore history", "success");
    } catch (err) {
      console.error("Plant upload failed:", err);
      addToast("Analysis failed: " + err.message, "error");
    } finally {
      setLoadingPlantUpload(false);
      if (plantFileInputRef.current) plantFileInputRef.current.value = "";
    }
  };

  const handlePlantFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handlePlantFile(file);
  };

  // Drag & drop handlers
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handlePlantFile(e.dataTransfer.files[0]);
    }
  };

  // ── Browser Camera Operations ─────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setVideoStream(stream);
      setCameraActive(true);
      addToast("Live camera viewport active", "info");
    } catch (err) {
      console.error("Camera access failed:", err);
      addToast("Could not access camera device", "error");
    }
  };

  const stopCamera = () => {
    if (videoStream) {
      videoStream.getTracks().forEach((track) => track.stop());
    }
    setVideoStream(null);
    setCameraActive(false);
  };

  const captureCameraSnapshot = async () => {
    if (!videoRef.current) return;
    setLoadingPlantUpload(true);
    try {
      const canvas = document.createElement("canvas");
      const videoEl = videoRef.current;
      
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
      
      const ctx = canvas.getContext("2d");
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], "camera-snap.jpg", { type: "image/jpeg" });
      
      await handlePlantFile(file);
      stopCamera();
    } catch (err) {
      console.error("Snapshot capture failed:", err);
      addToast("Failed to snap snapshot: " + err.message, "error");
      setLoadingPlantUpload(false);
    }
  };

  // Data helpers for pagination
  const diseasePageCount = Math.max(1, Math.ceil(diseaseHistory.length / 10));
  const activeDiseasePage = Math.min(diseasePage, diseasePageCount - 1);

  const currentDiseaseEvents = diseaseHistory.slice(
    activeDiseasePage * 10,
    (activeDiseasePage + 1) * 10,
  );

  const latestDiseaseEvent = diseaseHistory[0];

  // Checking Authentication loading cover
  if (checkingAuth) {
    return (
      <div className="authPage" style={{ display: 'flex', flexDirection: 'column', gap: '16px', justifyContent: 'center', alignItems: 'center', height: '100vh', background: 'var(--bg-page)' }}>
        <div className="spinner spinner-accent" style={{ width: '42px', height: '42px', borderWidth: '3px' }} />
        <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-heading)', fontSize: '18px', fontWeight: '700' }}>Securing Connection...</h2>
      </div>
    );
  }

  // Not logged in screen
  if (!user) {
    return (
      <div className="auth-page-container">
        <div className="auth-hero-panel">
          <div className="auth-hero-logo">
            <img src="/agroguard-logo.jpeg" alt="AgroGuard AI logo" />
            <h2>Agro<span>guard AI</span></h2>
          </div>
          <div className="auth-hero-content">
            <div className="auth-hero-quote">
              <h3>Precision agriculture crop health & leaf disease classification</h3>
              <p>
                Capture leaf snapshots in real-time or upload photos to analyze crop health instantly using Agroguard AI.
              </p>
            </div>
          </div>
          <div className="auth-hero-footer">
            &copy; 2026 Agroguard AI System. All rights reserved.
          </div>
        </div>
        
        <div className="auth-form-panel">
          <form className="auth-form-card" onSubmit={handleSignIn}>
            <span>Smart Farm Access</span>
            <h2>Welcome Back</h2>
            <p>Please enter your access credentials to view the diagnostics panel.</p>
            
            <div className="auth-input-group">
              <label htmlFor="email-input">Email</label>
              <input
                id="email-input"
                type="email"
                className="input-field"
                placeholder="operator@agroguard.ai"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            
            <div className="auth-input-group" style={{ marginBottom: '8px' }}>
              <label htmlFor="pass-input">Password</label>
              <input
                id="pass-input"
                type="password"
                className="input-field"
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            
            {authError && (
              <div className="auth-error-alert">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{authError}</span>
              </div>
            )}
            
            <button className="btn-primary" type="submit" disabled={authBusy} style={{ marginTop: '32px' }}>
              {signingIn ? <div className="spinner" /> : "Sign In"}
            </button>

            <div className="auth-divider">or</div>

            <button className="btn-outline btn-google" type="button" onClick={handleGoogleSignIn} disabled={authBusy}>
              {googleSigningIn ? <div className="spinner spinner-accent" /> : <><GoogleIcon /> Sign in with Google</>}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────
  // AUTHENTICATED PANEL SHELL
  // ────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      
      {/* ── Desktop Sidebar ── */}
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${mobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-logo">
          <div className="sidebar-brand-wrapper">
            <img src="/agroguard-logo.jpeg" alt="AgroGuard AI logo" />
            <h1 className="logo-text">Agro<span>guard AI</span></h1>
          </div>
          <button
            type="button"
            className="sidebar-collapse-toggle-btn"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            aria-label="Toggle sidebar width"
          >
            <MenuIcon />
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            type="button"
            className={`sidebar-nav-item ${activeSection === "overview" ? "active" : ""}`}
            onClick={() => { setActiveSection("overview"); setMobileMenuOpen(false); }}
          >
            <DashboardIcon />
            <span>Overview</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item ${activeSection === "analysis" ? "active" : ""}`}
            onClick={() => { setActiveSection("analysis"); setMobileMenuOpen(false); }}
          >
            <ScanIcon />
            <span>Plant Diagnosis</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item ${activeSection === "history" ? "active" : ""}`}
            onClick={() => { setActiveSection("history"); setMobileMenuOpen(false); }}
          >
            <HistoryIcon />
            <span>Diagnosis History</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="device-badge-sidebar online">
            <span className="pulse-glow green" />
            <div className="device-badge-sidebar-info">
              <h4>Agroguard Engine</h4>
              <p>AI Service Online</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile Header Bar ── */}
      <header className="mobile-header">
        <div className="mobile-logo">
          <img src="/agroguard-logo.jpeg" alt="AgroGuard AI logo" />
          <h1>Agro<span>guard AI</span></h1>
        </div>
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* ── Main content pane ── */}
      <main className={`main-content ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        
        {/* Top Header bar */}
        <div className="top-header">
          <div>
            <h2>
              {activeSection === "overview" && "Dashboard Command Center"}
              {activeSection === "analysis" && "Crop Plant Disease Analysis"}
              {activeSection === "history" && "Diagnostics History & Log Images"}
            </h2>
            <p>
              {activeSection === "overview" && "Executive summary of crop health classifications statistics."}
              {activeSection === "analysis" && "Capture leaf frames via camera or drop image files for classification."}
              {activeSection === "history" && "Browse past records, predictions scores, and snapshots."}
            </p>
          </div>

          <div className="top-header-actions">
            <button
              className="top-header-btn"
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? "Use Light Theme" : "Use Dark Theme"}
              aria-label="Toggle Theme"
            >
              {darkMode ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              className="top-header-btn-text"
              onClick={() => { signOut(auth); addToast("Signed out of station", "info"); }}
            >
              <LogOutIcon />
              Exit Session
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────── */}
        {/* VIEW 1: OVERVIEW PAGE */}
        {/* ────────────────────────────────────────────────── */}
        {activeSection === "overview" && (
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            <div className="overview-intro-card">
              <span>Agroguard</span>
              <h3>Crop Health Center</h3>
              <p>
                Evaluate plant health and analyze crop leaf conditions in real-time using Agroguard AI. Drag files or use your live camera streams to scan leaves.
              </p>
            </div>

            <div className="overview-stats-grid">
              <div className="stat-card" onClick={() => setActiveSection("analysis")}>
                <div className="stat-card-header">
                  <span className="stat-card-title">Diagnostics Status</span>
                  <div className="stat-card-icon"><ShieldIcon /></div>
                </div>
                <div className="stat-card-value">Engine Active</div>
                <p className="stat-card-desc">Agroguard service connected</p>
              </div>

              <div className="stat-card" onClick={() => setActiveSection("history")}>
                <div className="stat-card-header">
                  <span className="stat-card-title">Scan Log Count</span>
                  <div className="stat-card-icon"><HistoryIcon /></div>
                </div>
                <div className="stat-card-value">{diseaseHistory.length} Total Logs</div>
                <p className="stat-card-desc">Stored logs in Cloud Firestore</p>
              </div>

              <div className="stat-card" onClick={() => setActiveSection("history")}>
                <div className="stat-card-header">
                  <span className="stat-card-title">Latest Diagnosis</span>
                  <div className="stat-card-icon"><CheckIcon /></div>
                </div>
                <div className="stat-card-value" style={{ textTransform: 'capitalize' }}>{latestDiseaseEvent?.label || "No scans yet"}</div>
                <p className="stat-card-desc">
                  {latestDiseaseEvent
                    ? `${formatConfidence(latestDiseaseEvent.confidence)} confidence`
                    : "Ready for scan"}
                </p>
              </div>
            </div>

            <div className="overview-quick-actions">
              <h4>Classification Overrides</h4>
              <div className="quick-actions-btn-grid">
                <button type="button" className="btn-primary" onClick={() => setActiveSection("analysis")}>
                  Open Plant Diagnosis
                </button>
                <button type="button" className="btn-outline" onClick={() => setActiveSection("history")}>
                  <HistoryIcon />
                  Review Diagnosis History
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/* VIEW 2: PLANT DIAGNOSIS (CAMERA SNAP / UPLOAD) */}
        {/* ────────────────────────────────────────────────── */}
        {activeSection === "analysis" && (
          <div className="section-grid" style={{ animation: "fadeIn 0.3s ease" }}>
            
            {/* Live Camera Snap Section */}
            <div className="dashboard-card">
              <div className="card-header-block">
                <h3>Live Camera Capture</h3>
                <p>Use your laptop/phone camera to snap leaf photos directly from the browser viewport.</p>
              </div>
              <div className="card-body-block">
                <div className="camera-view-container">
                  {cameraActive ? (
                    <>
                      <div className="camera-viewport">
                        <video ref={videoRef} autoPlay playsInline />
                        <div className="camera-target-reticle" />
                      </div>
                      <div className="camera-actions-row">
                        <button 
                          className="btn-primary" 
                          onClick={captureCameraSnapshot}
                          disabled={loadingPlantUpload}
                        >
                          {loadingPlantUpload ? <div className="spinner" /> : <ScanIcon />}
                          Snap & Diagnose
                        </button>
                        <button 
                          className="btn-outline" 
                          onClick={stopCamera}
                          disabled={loadingPlantUpload}
                        >
                          Turn Off Camera
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: '40px 20px', textAlign: 'center', width: '100%' }}>
                      <h4>Live Camera Feed is Inactive</h4>
                      <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>Activate camera stream to snap snapshots directly.</p>
                      <button 
                        className="btn-primary" 
                        onClick={startCamera}
                        disabled={loadingPlantUpload}
                        style={{ maxWidth: '240px', margin: '0 auto' }}
                      >
                        Start Camera Device
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Drag & Drop File Upload Section */}
            <div className="dashboard-card">
              <div className="card-header-block">
                <h3>Drag & Drop File Upload</h3>
                <p>Drag an image file or browse locally to submit leaf photos for classification.</p>
              </div>
              <div className="card-body-block" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  id="plantFileInput"
                  ref={plantFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handlePlantFileChange}
                />

                <div 
                  className={`upload-dropzone ${dragActive ? "drag-active" : ""}`}
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => !loadingPlantUpload && plantFileInputRef.current?.click()}
                >
                  {loadingPlantUpload ? (
                    <div className="upload-preview-container">
                      <div className="spinner spinner-accent" style={{ width: '36px', height: '36px', borderWidth: '3px', marginBottom: '8px' }} />
                      <h4>Processing Upload...</h4>
                      <p>Calculating leaf classification markers</p>
                    </div>
                  ) : (
                    <>
                      <UploadIcon className="upload-dropzone-icon" />
                      <h4>Drag & Drop Leaf image here</h4>
                      <p>or click to browse local files</p>
                    </>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ────────────────────────────────────────────────── */}
        {/* VIEW 3: DIAGNOSIS HISTORY */}
        {/* ────────────────────────────────────────────────── */}
        {activeSection === "history" && (
          <div className="dashboard-card" style={{ animation: "fadeIn 0.3s ease" }}>
            <div className="card-header-block">
              <h3>Diagnosis Logs & Classification Records</h3>
              <p>Filter historical files log details, review classification details, and inspect full snapshots.</p>
            </div>
            
            <div className="card-body-block">
              
              <div className="history-header-actions" style={{ justifyContent: 'flex-end' }}>
                <div className="table-pagination">
                  <button 
                    className="pagination-btn" 
                    onClick={() => setDiseasePage(Math.max(0, activeDiseasePage - 1))}
                    disabled={activeDiseasePage === 0}
                    aria-label="Previous page"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <small style={{ fontWeight: 600 }}>Page {activeDiseasePage + 1} of {diseasePageCount}</small>
                  <button 
                    className="pagination-btn" 
                    onClick={() => setDiseasePage(activeDiseasePage + 1)}
                    disabled={activeDiseasePage >= diseasePageCount - 1}
                    aria-label="Next page"
                  >
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>

              {currentDiseaseEvents.length > 0 ? (
                <div className="table-responsive">
                  <table className="custom-modern-table">
                    <thead>
                      <tr>
                        <th>Captured Time</th>
                        <th>Data Source</th>
                        <th>Diagnosed Label</th>
                        <th>Model Accuracy</th>
                        <th>Camera Frame</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentDiseaseEvents.map((evt, idx) => {
                        const conf = formatConfidence(evt.confidence);
                        const imgStr = evt.imageBase64 || evt.imageUrl;
                        const displayImg = getDisplayImageSrc(imgStr);
                        
                        // Custom color class mapping for labels
                        const lbl = String(evt.label).toLowerCase();
                        let tagClass = "tag-badge info";
                        if (lbl.includes("healthy")) {
                          tagClass = "tag-badge success";
                        } else if (lbl.includes("rust") || lbl.includes("scab") || lbl.includes("rot")) {
                          tagClass = "tag-badge danger";
                        } else if (lbl !== "unknown" && lbl !== "n/a") {
                          tagClass = "tag-badge warning";
                        }

                        return (
                          <tr key={evt.timestamp || idx}>
                            <td style={{ fontWeight: 600 }}>{evt.timestamp || "N/A"}</td>
                            <td>
                              <span style={{ textTransform: 'capitalize', fontSize: '13px', margin: 0, fontWeight: 500 }}>
                                {evt.source || "N/A"}
                              </span>
                            </td>
                            <td>
                              <span className={tagClass} style={{ textTransform: 'capitalize' }}>
                                {evt.label || "N/A"}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--font-heading)', fontWeight: '600' }}>{conf}</td>
                            <td>
                              {displayImg ? (
                                <button
                                  type="button"
                                  className="btn-outline"
                                  style={{ margin: 0, padding: "6px 12px", fontSize: "12px", height: "30px", width: "auto" }}
                                  onClick={() => setImagePreview({ src: displayImg, title: `Crop Health Diagnosis - ${evt.label || "Leaf snapshot"}` })}
                                >
                                  Inspect Frame
                                </button>
                              ) : (
                                <span style={{ fontSize: '12px', color: 'var(--text-sub)' }}>No Frame</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '60px 20px', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                  <p style={{ margin: 0, color: 'var(--text-muted)' }}>No crop disease classification records found in your Firestore history.</p>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Footer info note */}
        <footer className="app-footer">
          <p>
            Agroguard AI &bull; Smart Crop Diagnostic Telemetry Console &bull; Realtime Diagnostics
          </p>
        </footer>
      </main>

      {/* ── Image Overlay Preview dialog ── */}
      {imagePreview && (
        <div 
          className="overlay-container" 
          role="dialog" 
          aria-modal="true" 
          aria-label="Image preview"
          onClick={() => setImagePreview(null)}
        >
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{imagePreview.title}</h3>
              <button
                type="button"
                className="top-header-btn"
                style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                onClick={() => setImagePreview(null)}
                aria-label="Close modal"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="modal-body">
              <img src={imagePreview.src} alt={imagePreview.title} />
            </div>
          </div>
        </div>
      )}

      {/* ── Analysis Result Popup Modal ── */}
      {analysisResult && (
        <div className="result-modal-backdrop" onClick={() => setAnalysisResult(null)}>
          <div className="result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="result-modal-header">
              <h3>Diagnosis Result</h3>
              <button
                type="button"
                className="result-modal-close-btn"
                onClick={() => setAnalysisResult(null)}
                aria-label="Close result"
              >
                <CloseIcon />
              </button>
            </div>

            {analysisResult.imageUrl && (
              <div className="result-modal-image-wrapper">
                <img src={analysisResult.imageUrl} alt="Analyzed leaf" />
              </div>
            )}

            <div className="result-modal-body">
              <div className="result-modal-row">
                <span className="result-modal-label">Diagnosis</span>
                <span className="result-modal-value" style={{ textTransform: "capitalize" }}>
                  {analysisResult.label}
                </span>
              </div>
              <div className="result-modal-row">
                <span className="result-modal-label">Confidence</span>
                <span className="result-modal-value accent">
                  {formatConfidence(analysisResult.confidence)}
                </span>
              </div>
              <div className="result-modal-row">
                <span className="result-modal-label">Scanned At</span>
                <span className="result-modal-value">{analysisResult.timestamp}</span>
              </div>
              <div className="result-modal-row">
                <span className="result-modal-label">Source</span>
                <span className="result-modal-value">{analysisResult.source}</span>
              </div>
            </div>

            <div className="result-modal-footer">
              <button
                type="button"
                className="btn-primary"
                onClick={() => { setAnalysisResult(null); setActiveSection("history"); }}
              >
                <HistoryIcon />
                View in History
              </button>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setAnalysisResult(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Animated Toast Container ── */}
      <div className="toast-overlay-container" aria-live="polite">
        {toasts.map((toast) => {
          let Icon = InfoIcon;
          if (toast.type === "success") Icon = CheckIcon;
          if (toast.type === "error") Icon = ErrorIcon;

          return (
            <div key={toast.id} className={`toast-item toast-${toast.type}`}>
              <div className="toast-icon-wrapper">
                <Icon />
              </div>
              <div className="toast-content-wrapper">
                <h5>
                  {toast.type === "success" && "Action Completed"}
                  {toast.type === "error" && "Operation Error"}
                  {toast.type === "info" && "Station Update"}
                </h5>
                <p>{toast.message}</p>
              </div>
              <button 
                type="button"
                className="toast-close-btn" 
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

    </div>
  );
}
