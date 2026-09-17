import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

function removeVietnameseDiacritics(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function makePdfFileName(personalId, fullName) {
  const code = removeVietnameseDiacritics(personalId || "hoso")
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .trim() || "hoso";
  const name = removeVietnameseDiacritics(fullName || "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim() || "khongten";
  return `${code}_${name}.pdf`;
}

const reportPdfCache = new WeakMap();

export function cancelReportPdf(node) {
  reportPdfCache.get(node)?.controller.abort();
  reportPdfCache.delete(node);
}

export async function buildProfilePdfBlob(node, onProgress = null) {
  while (node.reportReady) {
    const ready = node.reportReady;
    await ready;
    if (ready === node.reportReady) break;
  }
  if (!node.reportReady) return renderProfilePdf(node, onProgress);
  let job = reportPdfCache.get(node);
  if (!job || job.version !== node.reportReady) {
    cancelReportPdf(node);
    job = {
      version: node.reportReady,
      controller: new AbortController(),
      listeners: new Set(),
      progress: null,
    };
    reportPdfCache.set(node, job);
    const pages = Array.from(node.querySelectorAll('.sr-page-a4'), page => page.cloneNode(true));
    job.promise = renderIsolatedReport(pages, (current, total) => {
      job.progress = [current, total];
      for (const listener of job.listeners) listener(current, total);
    }, job.controller.signal).catch(error => {
      if (reportPdfCache.get(node) === job) reportPdfCache.delete(node);
      throw error;
    });
  }
  if (onProgress) {
    job.listeners.add(onProgress);
    if (job.progress) onProgress(...job.progress);
  }
  try {
    return await job.promise;
  } finally {
    if (onProgress) job.listeners.delete(onProgress);
  }
}

async function renderIsolatedReport(pages, onProgress, signal) {
  // html2canvas clones its entire owner document. Use a separate document
  // containing only the current page, rather than the app and whole report.
  const frame = document.createElement('iframe');
  frame.title = 'PDF rendering';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed', left: '-100000px', top: '0',
    width: '1200px', height: '900px', border: '0', pointerEvents: 'none',
  });
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    const base = doc.createElement('base');
    base.href = document.baseURI;
    doc.head.append(base);
    await Promise.all(Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'), original => {
      const copy = original.cloneNode(true);
      if (copy.tagName !== 'LINK') { doc.head.append(copy); return; }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Không tải được định dạng báo cáo.')), 15000);
        copy.onload = () => { clearTimeout(timer); resolve(); };
        copy.onerror = () => { clearTimeout(timer); reject(new Error('Không tải được định dạng báo cáo.')); };
        doc.head.append(copy);
      });
    }));
    signal.throwIfAborted();
    const stage = doc.createElement('div');
    stage.className = 'sr-report-root';
    doc.body.append(stage);
    stage.append(pages[0]);
    await doc.fonts.ready;
    return await renderProfilePdf(stage, onProgress, { pages, stage, signal });
  } finally {
    frame.remove();
  }
}
async function renderProfilePdf(node, onProgress, { pages, stage, signal } = {}) {
  const pageNodes = Array.from(node.querySelectorAll(".sr-page-a4"));
  const pagesToRender = pages || (pageNodes.length > 0 ? pageNodes : [node]);

  const firstPage = pagesToRender[0];
  const isLandscape =
    firstPage &&
    (firstPage.classList.contains("preview-a4-landscape") ||
      firstPage.offsetWidth > firstPage.offsetHeight);

  const pdf = new jsPDF({
    orientation: isLandscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });

  let pdfPageCount = 0;

  for (let idx = 0; idx < pagesToRender.length; idx++) {
    signal?.throwIfAborted();
    const pageEl = pagesToRender[idx];
    if (stage) stage.replaceChildren(pageEl);
    const orientation = pageEl.offsetWidth > pageEl.offsetHeight ? "landscape" : "portrait";
    if (onProgress) onProgress(idx + 1, pagesToRender.length);

    const imgs = Array.from(pageEl.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
            resolve();
          };
          const timer = setTimeout(done, 15000);
          img.addEventListener("load", done);
          img.addEventListener("error", done);
        });
      })
    );

    const canvas = await html2canvas(pageEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });
    signal?.throwIfAborted();

    if (!canvas || canvas.width === 0 || canvas.height === 0) continue;

    if (pdfPageCount > 0) pdf.addPage("a4", orientation);
    pdfPageCount++;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    const imgH = (canvas.height * pageW) / canvas.width;

    if (imgH <= pageH + 2) {
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, Math.min(pageH, imgH));
    } else {
      let remaining = imgH;
      let y = 0;
      const ratio = canvas.width / pageW;
      const sliceHeightPx = pageH * ratio;

      while (remaining > 1) {
        const currentSliceH = Math.min(sliceHeightPx, canvas.height - y * ratio);
        if (currentSliceH <= 0.5) break;

        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.round(currentSliceH);
        const ctx = sliceCanvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(
          canvas,
          0, y * ratio, canvas.width, currentSliceH,
          0, 0, canvas.width, currentSliceH,
        );

        const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.95);
        const sliceHmm = currentSliceH / ratio;

        if (y > 0) {
          pdf.addPage("a4", orientation);
          pdfPageCount++;
        }
        pdf.addImage(sliceData, "JPEG", 0, 0, pageW, sliceHmm);
        y += pageH;
        remaining -= pageH;
      }
    }
    // Let the preview and user input paint between pages during preparation.
    if (stage) await new Promise(resolve => setTimeout(resolve, 0));
  }

  return pdf.output("blob");
}

export async function exportProfilePdf(node, { fileName }) {
  const blob = await buildProfilePdfBlob(node);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
