import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

// Catch any unhandled renderer error so the whole window does not go white.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: any, info: any) {
    console.error("Renderer error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-white text-[#111827] p-6">
          <div className="text-center">
            <h1 className="text-[16px] font-semibold text-[#DC2626] mb-2">Something went wrong</h1>
            <p className="text-[12px] text-[#6B7280] mb-4">The companion encountered an error. Please close and reopen the window.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-1.5 text-[12px] text-white bg-[#2563EB] hover:bg-[#1D4ED8]"
              style={{ borderRadius: 2 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
