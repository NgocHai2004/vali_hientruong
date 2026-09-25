import { apiT } from "./i18n";

const TOKEN_KEY = "cccd_token";
const USER_KEY = "cccd_user";
const ROLE_KEY = "cccd_role";
const FULL_NAME_KEY = "cccd_full_name";

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => localStorage.getItem(USER_KEY),
  getRole: () => localStorage.getItem(ROLE_KEY) || "user",
  getFullName: () => localStorage.getItem(FULL_NAME_KEY) || "",
  save: (token, username, role = "user", fullName = "") => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    localStorage.setItem(ROLE_KEY, role);
    localStorage.setItem(FULL_NAME_KEY, fullName || "");
  },
  setFullName: (fullName) => localStorage.setItem(FULL_NAME_KEY, fullName || ""),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(FULL_NAME_KEY);
  },
};

let onAuthExpired = null;
export const setOnAuthExpired = (fn) => { onAuthExpired = fn; };

// Lỗi mạng (fetch throw trước khi có response) — Vite drop / ERR_EMPTY_RESPONSE /
// reset / timeout. KHÔNG phải HTTP status, không đáng tin để logout.
const NETWORK_ERR_RE = /Failed to fetch|NetworkError|ERR_|Load failed|networkerror/i;
export function isNetworkError(e) {
  const msg = (e?.message || "") + " " + (e?.name || "");
  return NETWORK_ERR_RE.test(msg);
}

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, { ...opts, headers });
  } catch (netErr) {
    throw new Error(apiT("api.error.network", { message: netErr.message }));
  }
  if (res.status === 401 && !opts.skipAuthExpire) {
    auth.clear();
    if (onAuthExpired) onAuthExpired();
    throw new Error(apiT("api.error.auth_expired"));
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    console.error("[api]", path, res.status, data);
    let msg;
    if (Array.isArray(data?.detail)) {
      msg = data.detail.map((e) => `${e.loc ? e.loc.join(".") : "?"}: ${e.msg}`).join("; ");
    } else {
      msg = (data && data.detail) || (typeof data === "string" ? data : apiT("api.error.server"));
    }
    throw new Error(msg);
  }
  return data;
}

async function downloadFile(path, defaultName) {
  const token = auth.getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(apiT("api.error.download_failed", { status: res.status }));
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m ? m[1] : defaultName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchExportBlob(path, defaultName) {
  const token = auth.getToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(apiT("api.error.download_failed", { status: res.status }));
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m ? m[1] : defaultName;
  return { blob, filename };
}

export const usbApi = {
  listWritable: async () => {
    let res;
    try {
      res = await fetch("/usb/api/usb/writable-drives");
    } catch (netErr) {
      throw new Error(apiT("usb.export.err.service_down"));
    }
    if (!res.ok) throw new Error(apiT("usb.export.err.service_down"));
    return res.json();
  },
  saveExport: async (drive, filename, blob) => {
    const fd = new FormData();
    fd.append("drive", drive);
    fd.append("file", new File([blob], filename));
    let res;
    try {
      res = await fetch("/usb/api/usb/save-export", { method: "POST", body: fd });
    } catch (netErr) {
      throw new Error(apiT("usb.export.err.service_down"));
    }
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new Error((data && data.detail) || (typeof data === "string" ? data : apiT("api.error.server")));
    }
    return data;
  },
};

/**
 * Xuất file XLSX ra USB người dùng chỉ định thay vì tải về máy.
 * @param {string} sourcePath   Backend path tra ve XLSX (vi du /api/detainees/export/xlsx).
 * @param {string} defaultFilename  Ten fallback neu server khong dat Content-Disposition.
 * @param {(drives:Array)=>Promise<Object|null>} pickDrive
 *        Callback UI: nhan danh sach drive, tra ve drive user chon (hoac null neu huy).
 * @returns {Promise<{cancelled?:boolean, path?:string, filename?:string, bytes_written?:number}>}
 */
export async function exportToUsb(sourcePath, defaultFilename, pickDrive) {
  const info = await usbApi.listWritable();
  const drives = info.drives || [];
  const dongles = info.dongle_drives || [];
  if (drives.length === 0) {
    if (dongles.length > 0) throw new Error(apiT("usb.export.err.only_dongle"));
    throw new Error(apiT("usb.export.err.no_drive"));
  }
  let chosen;
  if (drives.length === 1) {
    chosen = drives[0];
  } else {
    chosen = await pickDrive(drives);
    if (!chosen) return { cancelled: true };
  }
  const { blob, filename } = await fetchExportBlob(sourcePath, defaultFilename);
  const saved = await usbApi.saveExport(chosen.path, filename, blob);
  return saved;
}

export const api = {
  request,

  login: async (username, password) => {
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("password", password);
    let res;
    try {
      res = await fetch("/api/auth/login", {
        method: "POST",
        body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch (netErr) {
      throw new Error(apiT("api.error.network", { message: netErr.message }));
    }
    let data;
    try { data = await res.json(); } catch { throw new Error(apiT("api.error.login_bad_response")); }
    if (!res.ok) {
      const detail = Array.isArray(data?.detail)
        ? data.detail.map((e) => `${e.loc ? e.loc.join(".") : "?"}: ${e.msg}`).join("; ")
        : data.detail;
      throw new Error(detail || apiT("api.error.login_failed", { status: res.status }));
    }
    if (!data.access_token) throw new Error(apiT("api.error.login_no_token"));
    auth.save(data.access_token, data.username, data.role || "user", data.full_name || "");
    return data;
  },
  me: () => request("/api/auth/me"),
  updateMe: (body) => request("/api/auth/me", { method: "PATCH", body: JSON.stringify(body) }),
  verifyDongle: () => request("/api/auth/dongle-verify", { skipAuthExpire: true }),
  health: () => fetch("/api/health").then((r) => r.json()).catch(() => ({ ok: false })),
  fingerprintConfig: () => request("/api/config/fingerprint"),
  updateFingerprintConfig: (body) => request("/api/config/fingerprint", { method: "PUT", body: JSON.stringify(body) }),
  // Nguong doi sach dau vet hien truong (HBIE). GET moi user doc duoc de ve thang
  // diem; PUT chi admin.
  hbieConfig: () => request("/api/config/hbie"),
  updateHbieConfig: (body) => request("/api/config/hbie", { method: "PUT", body: JSON.stringify(body) }),

  stats: () => request("/api/stats"),

  listCells: () => request("/api/cells"),
  createCell: (body) => request("/api/cells", { method: "POST", body: JSON.stringify(body) }),
  updateCell: (id, body) => request(`/api/cells/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCell: (id) => request(`/api/cells/${id}`, { method: "DELETE" }),

  listDetainees: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, v);
    });
    const s = qs.toString();
    return request(`/api/detainees${s ? `?${s}` : ""}`);
  },
  getDetainee: (id) => request(`/api/detainees/${id}`),
  getDetaineeByPersonalId: (personalId) => request(`/api/detainees/by-personal-id/${encodeURIComponent(personalId)}`),
  createDetainee: (body) => request("/api/detainees", { method: "POST", body: JSON.stringify(body) }),
  updateDetainee: (id, body) => request(`/api/detainees/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteDetainee: (id) => request(`/api/detainees/${id}`, { method: "DELETE" }),
  transferDetainee: (id, cell_code) => request(`/api/detainees/${id}/transfer`, {
    method: "POST",
    body: JSON.stringify({ cell_code }),
  }),
  checkDuplicate: (body) => request("/api/detainees/check-duplicate", { method: "POST", body: JSON.stringify(body) }),

  // Tra cứu đối tượng đã đăng ký theo số CCCD (toàn hệ thống). Trả {matched, detainee}.
  checkCccd: (cccdNumber) => request(`/api/detainees/check-cccd?cccd_number=${encodeURIComponent(cccdNumber)}`),

  matchFingerprint: (fingers) => request("/api/detainees/match_fingerprint", {
    method: "POST",
    body: JSON.stringify({ fingers }),
  }),

  // Luồng Search: quét 1 ngón bất kỳ, so với mọi ngón của nghi phạm. Ngưỡng rất cao (>95).
  matchFingerprintSingle: (templateB64) => request("/api/detainees/match_fingerprint_single", {
    method: "POST",
    body: JSON.stringify({ template_b64: templateB64 }),
  }),

  uploadPhoto: async (file, typeOrOpts = "") => {
    const fd = new FormData();
    fd.append("file", file);
    const qs = new URLSearchParams();
    if (typeof typeOrOpts === "string") {
      if (typeOrOpts) qs.set("type", typeOrOpts);
    } else if (typeOrOpts && typeof typeOrOpts === "object") {
      if (typeOrOpts.type) qs.set("type", typeOrOpts.type);
      if (typeOrOpts.category) qs.set("category", typeOrOpts.category);
      if (typeOrOpts.detaineeId || typeOrOpts.detainee_id) qs.set("detainee_id", typeOrOpts.detaineeId || typeOrOpts.detainee_id);
      if (typeOrOpts.caseId || typeOrOpts.case_id) qs.set("case_id", typeOrOpts.caseId || typeOrOpts.case_id);
    }
    const qStr = qs.toString();
    return request(`/api/upload/photo${qStr ? `?${qStr}` : ""}`, { method: "POST", body: fd });
  },


  importXlsx: async (formData) => request("/api/detainees/import/xlsx", { method: "POST", body: formData }),
  downloadExport: () => downloadFile("/api/detainees/export/xlsx", "nghi_pham.xlsx"),
  downloadTemplate: () => downloadFile("/api/detainees/template/xlsx", "mau_import.xlsx"),

  listLogs: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const s = qs.toString();
    return request(`/api/logs${s ? `?${s}` : ""}`);
  },

  listUsers: () => request("/api/users"),
  createUser: (body) => request("/api/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: "DELETE" }),
  uploadUserAvatar: async (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/api/users/${id}/avatar`, { method: "POST", body: fd });
  },

  // ===== Vụ án (collection `cases`, thay cho phiên làm việc cũ) =====
  listCases: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, v);
    });
    const s = qs.toString();
    return request(`/api/cases${s ? `?${s}` : ""}`);
  },
  createCase: (body) => request("/api/cases", { method: "POST", body: JSON.stringify(body || {}) }),
  // patch = { name?, location?, occurred_at?, note?, status? }. Field khong gui thi
  // backend giu nguyen. Ket thuc vu an = updateCase(id, { status: "closed" }) —
  // khong con endpoint /close rieng.
  updateCase: (id, patch) => request(`/api/cases/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch || {}),
  }),
  getCase: (id) => request(`/api/cases/${id}`),
  closeCase: (id) => request(`/api/cases/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "closed" }),
  }),
  deleteCase: (id) => request(`/api/cases/${id}`, { method: "DELETE" }),
  downloadCaseReport: (id, filename) => downloadFile(`/api/cases/${id}/report`, filename || `case_report.xlsx`),
  logCaseSync: (id, summary) => request(`/api/cases/${id}/sync-log`, {
    method: "POST",
    body: JSON.stringify(summary || {}),
  }),

  // ===== Dấu vết hiện trường (ảnh theo vụ án) =====
  // Không truyền caseId => backend lấy vụ án đang điều tra gần nhất.
  listSceneTraces: (caseId) => request(
    `/api/scene/traces${caseId ? `?case_id=${encodeURIComponent(caseId)}` : ""}`
  ),
  // source: "camera" (chụp tại chỗ) | "upload" (chọn file). Ảnh do máy ngoài
  // bắn sang đi qua /api/scene/push nên không có ở đây.
  createSceneTrace: async (file, { caseId = "", case_id = "", sessionId = "", session_id = "", note = "", source = "upload" } = {}) => {
    const cid = caseId || case_id || sessionId || session_id || "";
    const fd = new FormData();
    fd.append("file", file);
    if (cid) fd.append("case_id", cid);
    if (note) fd.append("note", note);
    fd.append("source", source);
    return request("/api/scene/traces", { method: "POST", body: fd });
  },
  createSceneTracesBatch: async (files, { caseId = "", case_id = "", note = "", source = "upload" } = {}) => {
    const cid = caseId || case_id || "";
    const fd = new FormData();
    Array.from(files || []).forEach((file) => fd.append("files", file));
    if (cid) fd.append("case_id", cid);
    if (note) fd.append("note", note);
    fd.append("source", source);
    return request("/api/scene/traces/batch", { method: "POST", body: fd });
  },
  // patch = { note?, trace_type?, collection_source? }. Field khong gui thi backend
  // giu nguyen. Truyen string thay object van chay (chi sua ghi chu) cho caller cu.
  updateSceneTrace: (id, patch) => request(`/api/scene/traces/${id}`, {
    method: "PATCH",
    body: JSON.stringify(typeof patch === "string" ? { note: patch } : patch),
  }),
  deleteSceneTrace: (id) => request(`/api/scene/traces/${id}`, { method: "DELETE" }),
  deleteSceneTracesByCase: (caseId) => request(
    `/api/scene/traces?case_id=${encodeURIComponent(caseId)}`,
    { method: "DELETE" },
  ),

  // ===== Đối sánh dấu vết (engine HBIE) =====
  // Bảng KẾT QUẢ ĐỐI SÁNH của vụ án. Tra ve { items, total, config } — config co
  // threshold + score_max=1000 de UI ve thang diem dung, khong hardcode.
  listSceneMatches: ({ caseId = "", traceId = "" } = {}) => {
    const qs = new URLSearchParams();
    if (caseId) qs.set("case_id", caseId);
    if (traceId) qs.set("trace_id", traceId);
    const s = qs.toString();
    return request(`/api/scene/matches${s ? `?${s}` : ""}`);
  },
  // Doi sanh lai 1 dau vet: chay DONG BO (cho ket qua trả về) — khac luc upload
  // (chay nen). Dung khi anh loi luc up, hoac vu an vua them doi tuong moi.
  // Doi sanh lai TOAN BO dau vet trong vu an (ho tro them extra_case_ids de doi sanh lien vu)
  rematchSceneCase: (caseId, extraCaseIds = []) => {
    if (extraCaseIds && extraCaseIds.length > 0) {
      return request("/api/scene/rematch", {
        method: "POST",
        body: JSON.stringify({ case_id: caseId, extra_case_ids: extraCaseIds }),
      });
    }
    return request(`/api/scene/rematch${caseId ? `?case_id=${encodeURIComponent(caseId)}` : ""}`, { method: "POST" });
  },
  hbieHealth: () => request("/api/scene/hbie/health"),
  generateSceneReport: ({ caseId, scope = "all", matchId = null }) =>
    request("/api/scene/reports/generate", {
      method: "POST",
      body: JSON.stringify({ case_id: caseId || null, scope, match_id: matchId }),
    }),
  getSceneReportStatus: (reportId) => request(`/api/scene/reports/${reportId}/status`),
  fetchSceneReportPdfBlob: (reportId, filename) =>
    fetchExportBlob(`/api/scene/reports/${reportId}/pdf`, filename),
};

// ============ ZKFinger fingerprint sensor API (python service :8767) ============
async function fpRequest(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(path, { ...opts, headers });
  } catch (netErr) {
    throw new Error(apiT("api.error.fp_network", { message: netErr.message }));
  }
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (data && data.detail) || (typeof data === "string" ? data : apiT("api.error.fp_server"));
    throw new Error(msg);
  }
  return data;
}

export const fpApi = {
  health: () => fpRequest("/fp/api/health"),
  listFingers: () => fpRequest("/fp/api/fingers"),
  // Cac cum chup (4 ngon trai / 2 ngon cai / 4 ngon phai) + ma ngon trong cum.
  listSteps: () => fpRequest("/fp/api/steps"),
  startSession: (userName) => fpRequest("/fp/api/session/start", {
    method: "POST",
    body: JSON.stringify({ user_name: userName }),
  }),
  getSession: (sid) => fpRequest(`/fp/api/session/${sid}`),
  // Morfin: chup theo CUM (step). Bo trong step => service tu chon cum ke tiep.
  capture: (sid, step) => fpRequest(`/fp/api/session/${sid}/capture`, {
    method: "POST",
    body: JSON.stringify({ step: step || null }),
  }),
  redo: (sid, code) => fpRequest(`/fp/api/session/${sid}/redo/${code}`, { method: "POST" }),
  // Can bo chap nhan CA CUM sau khi xem anh. Buoc BAT BUOC cho moi cum: chua
  // confirm thi service khong coi cum la xong, next_step van tra ve chinh cum do.
  confirmStep: (sid, step) => fpRequest(`/fp/api/session/${sid}/confirm_step`, {
    method: "POST",
    body: JSON.stringify({ step }),
  }),
  // Danh dau / bo danh dau ngon "khong co van tay" => ghi none, khong co anh.
  // Danh dau TRUOC khi chup: cum se chi cho dung so ngon that su co.
  markNone: (sid, codes, value = true) => fpRequest(`/fp/api/session/${sid}/mark_none`, {
    method: "POST",
    body: JSON.stringify({ codes, value }),
  }),
  cancel: (sid) => fpRequest(`/fp/api/session/${sid}`, { method: "DELETE" }),
  // Abort lenh chup dang cho tay o tang THIET BI. Bat buoc phai goi truoc cancel():
  // DELETE session KHONG nha thiet bi (da test: sau DELETE, /api/live van active
  // = true va session moi capture bi 409 "Dang co lenh chup khac chay").
  stopCapture: () => fpRequest("/fp/api/capture/stop", { method: "POST" }),
};


// base64 PNG (không kèm data:image/png;base64,) → File
export async function b64PngToFile(b64, filename) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const blob = new Blob([buf], { type: "image/png" });
  return new File([blob], filename, { type: "image/png" });
}
