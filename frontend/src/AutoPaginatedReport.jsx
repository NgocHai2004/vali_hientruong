import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { paginateReport, waitForReportAssets } from "./lib/paginateReport";
import { buildProfilePdfBlob, cancelReportPdf } from "./lib/exportProfilePdf";

// React owns the source; the paginator owns only the empty pages container.
export default forwardRef(function AutoPaginatedReport({ children, footer }, ref) {
  const rootRef = useRef(null);
  const sourceRef = useRef(null);
  const pagesRef = useRef(null);
  const footerRef = useRef(null);
  const signatureRef = useRef(null);
  const warmupRef = useRef(null);
  useImperativeHandle(ref, () => rootRef.current, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const signature = sourceRef.current.innerHTML + footerRef.current.innerHTML;
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;
    clearTimeout(warmupRef.current);
    cancelReportPdf(root);
    const ready = waitForReportAssets(sourceRef.current).then(() => {
      if (root.reportReady !== ready || !root.isConnected) return;
      paginateReport(sourceRef.current, pagesRef.current, footerRef.current.firstElementChild);
      // Paint the preview first, then prepare the shared PDF without downloading.
      warmupRef.current = setTimeout(() => {
        if (root.isConnected && root.reportReady === ready) {
          buildProfilePdfBlob(root).catch(() => {});
        }
      }, 100);
    });
    root.reportReady = ready;
    // Export awaits the original promise and displays any layout error.
    root.reportReady.catch(() => {});
  }, [children, footer]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    return () => {
      clearTimeout(warmupRef.current);
      signatureRef.current = null;
      root.reportReady = null;
      cancelReportPdf(root);
    };
  }, []);

  return (
    <div ref={rootRef}>
      <div ref={sourceRef} hidden aria-hidden="true">{children}</div>
      <div ref={footerRef} hidden aria-hidden="true">{footer}</div>
      <div ref={pagesRef} className="sr-report-root" />
    </div>
  );
});
