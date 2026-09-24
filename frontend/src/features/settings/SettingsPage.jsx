import React, { useState, useEffect, Fragment } from "react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { toast } from "../../Toast";
import { PageHeader, StateBox, FieldRow } from "../../components/common/CommonUI";

const Icon = {
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
  ),
};

const FP_QUALITY_RECOMMENDED = 50;

const FP_SETTINGS_HANDS = [
  { hand: "left", codes: ["left_thumb", "left_index", "left_middle", "left_ring", "left_little"] },
  { hand: "right", codes: ["right_thumb", "right_index", "right_middle", "right_ring", "right_little"] },
];
const FP_SETTINGS_CODES = FP_SETTINGS_HANDS.flatMap((h) => h.codes);
const FP_SETTINGS_DIGITS = ["thumb", "index", "middle", "ring", "little"];

export function SettingsPage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fpQ, setFpQ] = useState({});
  const [fpSaving, setFpSaving] = useState(false);
  const [fpError, setFpError] = useState("");
  const [hbie, setHbie] = useState(null);
  const [matchThr, setMatchThr] = useState("");
  const [keepScore, setKeepScore] = useState("");
  const [hbieSaving, setHbieSaving] = useState(false);
  const [hbieError, setHbieError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.hbieConfig(), api.fingerprintConfig()])
      .then(([hb, fp]) => {
        if (cancelled) return;
        if (hb.status === "fulfilled") {
          setHbie(hb.value);
          setMatchThr(String(hb.value?.match_threshold ?? ""));
          setKeepScore(String(hb.value?.keep_score ?? ""));
        } else {
          setError(hb.reason?.message || String(hb.reason));
        }
        const by = fp.status === "fulfilled" ? (fp.value?.by_finger || {}) : {};
        const def = Number(fp.status === "fulfilled" ? fp.value?.default : NaN);
        const fallback = Number.isFinite(def) ? def : FP_QUALITY_RECOMMENDED;
        const next = {};
        for (const c of FP_SETTINGS_CODES) {
          const q = Number(by[c]);
          next[c] = String(Number.isFinite(q) ? q : fallback);
        }
        setFpQ(next);
        if (fp.status !== "fulfilled") {
          console.warn("[settings] doc nguong van tay loi:", fp.reason);
        }
        if (hb.status !== "fulfilled") {
          console.warn("[settings] doc nguong doi sach dau vet loi:", hb.reason);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const submitFp = async (e) => {
    e.preventDefault();
    const payload = {};
    for (const c of FP_SETTINGS_CODES) {
      const raw = (fpQ[c] ?? "").trim();
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 0 || n > 100) {
        setFpError(t("settings.fp.err.invalid_at", {
          f: t(`fp.finger.${c}.long`),
        }));
        return;
      }
      payload[c] = n;
    }
    setFpSaving(true);
    setFpError("");
    try {
      const res = await api.updateFingerprintConfig({ by_finger: payload });
      const by = res?.by_finger || {};
      setFpQ((prev) => {
        const next = { ...prev };
        for (const c of FP_SETTINGS_CODES) {
          if (by[c] !== undefined) next[c] = String(by[c]);
        }
        return next;
      });
      toast.success(res?.applied === false
        ? t("settings.fp.saved_pending")
        : t("settings.saved"));
    } catch (e) {
      setFpError(e.message);
    } finally {
      setFpSaving(false);
    }
  };

  const scoreMax = Number(hbie?.score_max) || 1000;
  const mNum = Number(matchThr);
  const kNum = Number(keepScore);
  const mOk = matchThr.trim() !== "" && Number.isInteger(mNum) && mNum >= 1 && mNum <= scoreMax;
  const kOk = keepScore.trim() !== "" && Number.isInteger(kNum) && kNum >= 0 && kNum <= scoreMax;
  const pairOk = mOk && kOk && kNum <= mNum;
  const defMatch = Number(hbie?.defaults?.match_threshold);
  const thrLowered = mOk && Number.isFinite(defMatch) && mNum < defMatch;

  const submitHbie = async (e) => {
    e.preventDefault();
    if (!mOk) {
      setHbieError(t("settings.hbie.err.match", { max: scoreMax }));
      return;
    }
    if (!kOk || kNum > mNum) {
      setHbieError(t("settings.hbie.err.keep", { max: mNum }));
      return;
    }
    setHbieSaving(true);
    setHbieError("");
    try {
      const res = await api.updateHbieConfig({ match_threshold: mNum, keep_score: kNum });
      setMatchThr(String(res.match_threshold));
      setKeepScore(String(res.keep_score));
      const rc = res?.reclassified || {};
      toast.success(rc.pairs || rc.traces
        ? t("settings.hbie.saved_reclassified", { p: rc.pairs || 0, n: rc.traces || 0 })
        : t("settings.saved"));
      if (res?.needs_rematch) toast.info(t("settings.hbie.saved_rematch"), 8000);
    } catch (e) {
      setHbieError(e.message);
    } finally {
      setHbieSaving(false);
    }
  };

  const resetHbie = () => {
    const d = hbie?.defaults;
    if (!d) return;
    setMatchThr(String(d.match_threshold));
    setKeepScore(String(d.keep_score));
    setHbieError("");
  };

  const fpLowCodes = FP_SETTINGS_CODES.filter((c) => {
    const raw = (fpQ[c] ?? "").trim();
    if (raw === "") return false;
    const n = Number(raw);
    return Number.isFinite(n) && n < FP_QUALITY_RECOMMENDED;
  });

  return (
    <div className="page">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      {error && <StateBox type="error">{error}</StateBox>}

      {loading ? (
        <div className="table-card" style={{ padding: 20 }}>
          <StateBox>{t("common.loading")}</StateBox>
        </div>
      ) : (
        <div className="settings-grid">
          <section className="table-card settings-card settings-card-hbie">
            <form className="form" onSubmit={submitHbie}>
              <div className="settings-card-head settings-card-head-row">
                <span className="settings-card-icon">{Icon.search}</span>
                <div>
                  <h2>{t("settings.hbie.title")}</h2>
                  <p>{t("settings.hbie.desc", { max: scoreMax })}</p>
                </div>
                <button type="submit" className="button primary" disabled={hbieSaving || !pairOk}>
                  {hbieSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
              {hbieError && <StateBox type="error">{hbieError}</StateBox>}

              <div className="settings-hbie-body">
                <div>
                  <FieldRow label={t("settings.hbie.match_threshold.label")}>
                    <input
                      className="control"
                      type="number"
                      min="1"
                      max={scoreMax}
                      step="1"
                      value={matchThr}
                      onChange={(e) => setMatchThr(e.target.value)}
                      aria-invalid={!mOk ? "true" : undefined}
                      required
                    />
                  </FieldRow>
                  <p className="settings-fp-note">{t("settings.hbie.match_threshold.desc")}</p>

                  <FieldRow label={t("settings.hbie.keep_score.label")}>
                    <input
                      className="control"
                      type="number"
                      min="0"
                      max={scoreMax}
                      step="1"
                      value={keepScore}
                      onChange={(e) => setKeepScore(e.target.value)}
                      aria-invalid={!kOk ? "true" : undefined}
                      required
                    />
                  </FieldRow>
                  <p className="settings-fp-note">{t("settings.hbie.keep_score.desc")}</p>

                  <div className="modal-actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="button"
                      onClick={resetHbie}
                      disabled={hbieSaving || !hbie?.defaults}
                    >
                      {t("settings.hbie.reset", {
                        m: hbie?.defaults?.match_threshold ?? "—",
                        k: hbie?.defaults?.keep_score ?? "—",
                      })}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="settings-preview-table-wrap">
                    <table className="settings-preview-table">
                      <thead>
                        <tr>
                          <th>{t("settings.hbie.bands.col_range")}</th>
                          <th>{t("settings.hbie.bands.col_effect")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{mOk ? `≥ ${mNum}` : "—"}</td>
                          <td>{t("smp.matched")}</td>
                        </tr>
                        <tr>
                          <td>{pairOk ? `${kNum} – ${mNum - 1}` : "—"}</td>
                          <td>{t("smp.review")}</td>
                        </tr>
                        <tr>
                          <td>{kOk ? `< ${kNum}` : "—"}</td>
                          <td>{t("settings.hbie.bands.dropped")}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {thrLowered ? (
                    <p className="settings-fp-note" style={{ color: "var(--danger, #e5484d)" }}>
                      {t("settings.hbie.warn_low", { v: defMatch })}
                    </p>
                  ) : (
                    <p className="settings-fp-note">{t("settings.hbie.note")}</p>
                  )}
                </div>
              </div>
            </form>
          </section>

          <section className="table-card settings-card settings-card-fp">
            <form className="form" onSubmit={submitFp}>
              <div className="settings-card-head settings-card-head-row">
                <span className="settings-card-icon">{Icon.gear}</span>
                <div>
                  <h2>{t("settings.fp.title")}</h2>
                  <p>{t("settings.fp.min_quality.desc", { v: FP_QUALITY_RECOMMENDED })}</p>
                </div>
                <button type="submit" className="button primary" disabled={fpSaving}>
                  {fpSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
              {fpError && <StateBox type="error">{fpError}</StateBox>}
              <div className="settings-fp-matrix">
                <span />
                {FP_SETTINGS_DIGITS.map((d) => (
                  <div key={d} className="settings-fp-col-head">
                    {t(`settings.fp.digit.${d}`)}
                  </div>
                ))}
                {FP_SETTINGS_HANDS.map((h) => (
                  <Fragment key={h.hand}>
                    <span className="settings-fp-hand-label">
                      {t(`settings.fp.hand.${h.hand}`)}
                    </span>
                    {h.codes.map((c) => {
                      const raw = (fpQ[c] ?? "").trim();
                      const n = Number(raw);
                      const low = raw !== "" && Number.isFinite(n)
                        && n < FP_QUALITY_RECOMMENDED;
                      return (
                        <div key={c} className="settings-fp-cell">
                          <input
                            className="control settings-fp-input"
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={fpQ[c] ?? ""}
                            onChange={(e) => setFpQ((p) => ({ ...p, [c]: e.target.value }))}
                            aria-label={t("settings.fp.aria_input", {
                              f: t(`fp.finger.${c}.long`),
                            })}
                            aria-invalid={low ? "true" : undefined}
                            required
                          />
                          <span className="settings-fp-unit">%</span>
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
              {fpLowCodes.length > 0 ? (
                <p className="settings-fp-note" style={{ color: "var(--danger, #e5484d)" }}>
                  {t("settings.fp.warn_low", {
                    v: FP_QUALITY_RECOMMENDED,
                    list: fpLowCodes.map((c) => t(`fp.finger.${c}.long`)).join(", "),
                  })}
                </p>
              ) : (
                <p className="settings-fp-note">{t("settings.fp.desc")}</p>
              )}
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
