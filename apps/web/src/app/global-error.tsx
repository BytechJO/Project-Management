"use client";

import Image from "next/image";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f4f7fa", color: "#1f3042", fontFamily: "Arial, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ width: "min(100%, 440px)", padding: 32, border: "1px solid #d8e0e8", borderRadius: 18, background: "white", boxShadow: "0 18px 50px rgba(31, 48, 66, 0.12)", textAlign: "center" }}>
            <Image src="/bytech-logo.png" alt="Bytech" width={180} height={51} priority style={{ width: 180, height: "auto", marginBottom: 24 }} />
            <title>Bytech · Unexpected error</title>
            <h1 style={{ margin: "0 0 10px", fontSize: 28 }}>Something went wrong</h1>
            <p style={{ margin: "0 0 8px", lineHeight: 1.6 }}>The issue was recorded. Please try again.</p>
            <p dir="rtl" style={{ margin: "0 0 24px", lineHeight: 1.6 }}>تم تسجيل المشكلة. يرجى المحاولة مرة أخرى.</p>
            <button type="button" onClick={() => retry()} style={{ width: "100%", padding: "12px 18px", border: 0, borderRadius: 10, background: "#465c73", color: "white", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
              Try again · حاول مرة أخرى
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
