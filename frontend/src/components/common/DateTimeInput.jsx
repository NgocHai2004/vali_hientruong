import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

// Ô nhập ngày (giờ) hiển thị dd/mm/yyyy [hh:mm] — thay cho <input type="date|datetime-local">
// vì ô gốc hiển thị theo ngôn ngữ trình duyệt/HĐH (thường là mm/dd/yyyy) và trang không
// ép được. Giá trị vào/ra vẫn là chuỗi ISO cục bộ như ô gốc: "YYYY-MM-DDTHH:mm"
// (withTime) hoặc "YYYY-MM-DD", nên chỗ dùng chỉ đổi thẻ, không đổi state/API.
// Tiếng Anh giữ thứ tự mm/dd/yyyy cho khớp formatDate trong i18n.
const pad = (n) => String(n).padStart(2, "0");

function isoToDigits(iso, withTime, mdy) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso || "");
  if (!m) return "";
  const [, y, mo, d, h = "00", mi = "00"] = m;
  return (mdy ? mo + d : d + mo) + y + (withTime ? h + mi : "");
}

function formatDigits(digits, withTime) {
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  let out = parts.join("/");
  if (withTime && digits.length > 8) {
    out += " " + [digits.slice(8, 10), digits.slice(10, 12)].filter(Boolean).join(":");
  }
  return out;
}

function digitsToIso(digits, withTime, mdy) {
  if (digits.length !== (withTime ? 12 : 8)) return null;
  const a = Number(digits.slice(0, 2));
  const b = Number(digits.slice(2, 4));
  const y = Number(digits.slice(4, 8));
  const [d, mo] = mdy ? [b, a] : [a, b];
  const h = withTime ? Number(digits.slice(8, 10)) : 0;
  const mi = withTime ? Number(digits.slice(10, 12)) : 0;
  const dt = new Date(y, mo - 1, d, h, mi);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d
    || dt.getHours() !== h || dt.getMinutes() !== mi) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return withTime ? `${date}T${pad(h)}:${pad(mi)}` : date;
}

export default function DateTimeInput({
  value = "", onChange, withTime = true, className = "control", ...rest
}) {
  const { locale, t } = useI18n();
  const mdy = locale === "en";
  const maxDigits = withTime ? 12 : 8;
  const [text, setText] = useState(() => formatDigits(isoToDigits(value, withTime, mdy), withTime));
  const pickerRef = useRef(null);

  // Giá trị đổi từ ngoài (nút "Xoá bộ lọc", chọn từ lịch...) → đồng bộ lại chữ hiển thị.
  // Đang gõ dở (chưa đủ ngày hợp lệ) thì value vẫn giữ nguyên nên không bị ghi đè.
  useEffect(() => {
    setText((cur) => {
      const curIso = digitsToIso(cur.replace(/\D/g, ""), withTime, mdy) || "";
      return curIso === (value || "") ? cur : formatDigits(isoToDigits(value, withTime, mdy), withTime);
    });
  }, [value, withTime, mdy]);

  const handleChange = (e) => {
    const raw = e.target.value;
    let digits = raw.replace(/\D/g, "").slice(0, maxDigits);
    const prev = text.replace(/\D/g, "");
    // Xoá đúng ký tự phân cách ("/", ":", " "): số không đổi → bỏ luôn chữ số đứng trước nó.
    if (raw.length < text.length && digits === prev) digits = prev.slice(0, -1);
    setText(formatDigits(digits, withTime));
    if (digits === "") onChange?.("");
    else {
      const iso = digitsToIso(digits, withTime, mdy);
      if (iso) onChange?.(iso);
    }
  };

  // Rời ô mà còn dở dang/sai ngày → trả về giá trị đang có hiệu lực, không để chữ rác.
  const handleBlur = () => {
    const iso = digitsToIso(text.replace(/\D/g, ""), withTime, mdy);
    if (text && !iso) setText(formatDigits(isoToDigits(value, withTime, mdy), withTime));
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try { el.showPicker(); return; } catch { /* rơi xuống focus */ }
    }
    el.focus();
  };

  const ph = mdy
    ? (withTime ? "mm/dd/yyyy hh:mm" : "mm/dd/yyyy")
    : (withTime ? "dd/mm/yyyy hh:mm" : "dd/mm/yyyy");

  return (
    <span className="date-input">
      <input
        {...rest}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={ph}
        maxLength={withTime ? 16 : 10}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      <button
        type="button"
        className="date-input-btn"
        onClick={openPicker}
        aria-label={t("common.pick_date")}
        title={t("common.pick_date")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 10h18" />
        </svg>
      </button>
      {/* Lịch gốc chỉ để chọn; chữ hiển thị luôn do ô trên quyết định. */}
      <input
        ref={pickerRef}
        className="date-input-native"
        type={withTime ? "datetime-local" : "date"}
        tabIndex={-1}
        aria-hidden="true"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </span>
  );
}
