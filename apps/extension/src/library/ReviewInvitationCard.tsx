import { useEffect, useRef, useState, type FC } from "react";
import { Button, Link } from "@fluentui/react-components";
import { useTranslation } from "../i18n/LocaleContext.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { isReviewInvitationEligible, type ReviewInvitationState } from "./ReviewInvitation.js";

type Simulation = "real" | "new" | "eligible" | "dismissed";

export const ReviewInvitationCard: FC<{ blocked: boolean; onDismiss: () => void }> = ({ blocked, onDismiss }) => {
  const t = useTranslation();
  const database = useRef<LibraryDatabase | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const claiming = useRef(false);
  const [state, setState] = useState<ReviewInvitationState>();
  const [visible, setVisible] = useState(false);
  const [simulation, setSimulation] = useState<Simulation>("real");
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setInView(entries.some(entry => entry.isIntersecting)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setForeground(document.visibilityState === "visible" && document.hasFocus());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let owned: LibraryDatabase | undefined;
    let unsubscribe: (() => void) | undefined;
    let revision = 0;
    setError(undefined);
    const load = async () => {
      const current = ++revision;
      try {
        const next = await owned!.getReviewInvitation();
        if (!disposed && revision === current) setState(next);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void LibraryDatabase.open().then(db => {
      if (disposed) { db.close(); return; }
      owned = db;
      database.current = db;
      unsubscribe = db.subscribePreferences(() => { void load(); });
      void load();
    }, cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      owned?.close();
      if (database.current === owned) database.current = undefined;
    };
  }, [retry]);

  useEffect(() => {
    const db = database.current;
    if (simulation !== "real" || blocked || !foreground || !inView || error || !state ||
      !isReviewInvitationEligible(state) || visible || claiming.current || !db) return;
    let disposed = false;
    claiming.current = true;
    void db.claimReviewInvitation().then(claimed => {
      if (!disposed && claimed) {
        setVisible(true);
        setState(current => current ? { ...current, presented: true } : current);
      }
    }, cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { claiming.current = false; });
    return () => { disposed = true; };
  }, [simulation, blocked, foreground, inView, error, state, visible, retry]);

  const dismiss = () => {
    if (simulation === "eligible") setSimulation("dismissed");
    else setVisible(false);
  };
  const show = !blocked && (simulation === "eligible" || (simulation === "real" && visible));
  return (
    <div ref={container} style={{ marginTop: 20 }}>
      {show && <section aria-label={t("review.title")} data-review-invitation=""
        style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: 8, padding: 16, maxWidth: 640 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 8px", fontWeight: 550 }}>{t("review.title")}</h2>
        <p style={{ margin: "0 0 12px" }}>{t("review.body")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
          <Link href="https://chromewebstore.google.com/detail/ambra-epub-reader/mcjkkebkhifgkkbahlcapjlnaihocogj/reviews"
            target="_blank" rel="noreferrer" onClick={dismiss}>{t("review.write")}</Link>
          <Link href="https://github.com/BCWalters/ambra/issues/new/choose" target="_blank" rel="noreferrer"
            onClick={dismiss}>{t("review.feedback")}</Link>
          <Button appearance="subtle" onClick={() => { dismiss(); onDismiss(); }}>{t("review.dismiss")}</Button>
        </div>
      </section>}
      {error && <div role="alert">
        <p>{t("review.error")}: {error}</p>
        <Button onClick={() => setRetry(value => value + 1)}>{t("review.retry")}</Button>
      </div>}
      <details lang="en" data-prototype-controls="" style={{ marginTop: 16, fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
        <summary>Local prototype controls</summary>
        <p>Review invitation: three reading days and at least halfway through a book. Shown once, only in the full Library.</p>
        <p>Simulation is temporary and never changes your books, reading history, or saved invitation state.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => setSimulation("eligible")}>Simulate eligible reader</Button>
          <Button size="small" onClick={() => setSimulation("new")}>Simulate new reader</Button>
          <Button size="small" onClick={() => setSimulation("eligible")}>Reset simulated invitation</Button>
          <Button size="small" onClick={() => setSimulation("real")}>Use real eligibility</Button>
        </div>
        <p role="status">Mode: {simulation}. Real reading days: {state?.days.length ?? 0}/3.
          Halfway reached: {state?.reachedHalf ? "yes" : "no"}. Already invited: {state?.presented ? "yes" : "no"}.</p>
      </details>
    </div>
  );
};
