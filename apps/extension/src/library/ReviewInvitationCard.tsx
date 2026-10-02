import { useEffect, useRef, useState, type FC } from "react";
import { Button } from "@fluentui/react-components";
import { CenteredDialog } from "../components/CenteredDialog.js";
import { useTranslation } from "../i18n/LocaleContext.js";
import { LibraryDatabase } from "./LibraryDatabase.js";
import { answerReviewInvitation, isReviewInvitationEligible, parseReviewInvitation, REVIEW_REMINDER_DELAY,
  type ReviewInvitationResponse, type ReviewInvitationState } from "./ReviewInvitation.js";

type Simulation = { readonly state: ReviewInvitationState; readonly now: number };
type Stage = "question" | "yes" | "no";

export const ReviewInvitationCard: FC<{
  blocked: boolean;
  onDismiss: () => void;
  onOpenChange?: (open: boolean) => void;
}> = ({ blocked, onDismiss, onOpenChange }) => {
  const t = useTranslation();
  const database = useRef<LibraryDatabase | undefined>(undefined);
  const claiming = useRef(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const responseLink = useRef<HTMLAnchorElement>(null);
  const [state, setState] = useState<ReviewInvitationState>();
  const [visible, setVisible] = useState(false);
  const [stage, setStage] = useState<Stage>("question");
  const [simulation, setSimulation] = useState<Simulation>();
  const simulationRef = useRef(simulation);
  simulationRef.current = simulation;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const [now, setNow] = useState(Date.now);
  const show = visible && !blocked;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    onOpenChange?.(show);
    return () => onOpenChange?.(false);
  }, [show, onOpenChange]);

  useEffect(() => {
    if (show && stage !== "question") responseLink.current?.focus();
  }, [show, stage]);

  useEffect(() => {
    const update = () => {
      setForeground(document.visibilityState === "visible" && document.hasFocus());
      setNow(Date.now());
    };
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
    if (!state?.nextPromptAt || state.presented || state.nextPromptAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(state.nextPromptAt - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [state, now]);

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
    if (blocked || !foreground || visible || error || claiming.current) return;
    if (simulation) {
      if (isReviewInvitationEligible(simulation.state, simulation.now)) {
        setStage("question");
        setVisible(true);
      }
      return;
    }
    const db = database.current;
    if (!state || !isReviewInvitationEligible(state, now) || !db) return;
    claiming.current = true;
    void db.claimReviewInvitation().then(claimed => {
      if (mounted.current && !simulationRef.current && claimed) {
        setStage("question");
        setVisible(true);
      }
    }, cause => {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { claiming.current = false; });
  }, [simulation, blocked, foreground, error, state, visible, retry, now]);

  const answer = async (response: ReviewInvitationResponse) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (simulation) {
        setSimulation({ ...simulation, state: answerReviewInvitation(simulation.state, response, simulation.now) });
      } else {
        if (!database.current) throw new Error("Review invitation database is not ready.");
        await database.current.respondToReviewInvitation(response);
      }
      if (!mounted.current) return;
      if (response === "later") setVisible(false);
      else setStage(response);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const dismiss = () => {
    if (stage === "question") void answer("later");
    else setVisible(false);
  };
  const simulate = (eligible: boolean) => {
    setVisible(false);
    setError(undefined);
    setSimulation({ now: Date.now(), state: eligible
      ? { days: ["2026-01-01", "2026-01-02", "2026-01-03"], reachedHalf: true, presented: false }
      : parseReviewInvitation(undefined) });
  };
  const errorMessage = error && <div role="alert">
    <p>{t("review.error")}: {error}</p>
    {!visible && <Button onClick={() => setRetry(value => value + 1)}>{t("review.retry")}</Button>}
  </div>;

  return (
    <div style={{ marginTop: 20 }}>
      <CenteredDialog open={show}
        title={t(stage === "question" ? "review.title" : stage === "yes" ? "review.yesTitle" : "review.noTitle")}
        onRequestClose={dismiss} onAfterClose={onDismiss}>
        <div data-review-invitation="" aria-busy={busy}>
          {stage === "question" ? <>
            <p>{t("review.body")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
              <Button appearance="primary" disabled={busy} onClick={() => { void answer("yes"); }}>{t("review.yes")}</Button>
              <Button disabled={busy} onClick={() => { void answer("no"); }}>{t("review.no")}</Button>
              <Button disabled={busy} onClick={() => { void answer("later"); }}>{t("review.later")}</Button>
            </div>
            <p style={{ fontSize: 12, color: "var(--colorNeutralForeground2)", marginBottom: 0 }}>{t("review.laterHint")}</p>
          </> : <>
            <p>{t(stage === "yes" ? "review.yesBody" : "review.noBody")}</p>
            {stage === "yes" && <p>{t("review.thanks")}</p>}
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 16, marginTop: 16 }}>
              <Button as="a" role="link" ref={responseLink} appearance="primary"
                href={stage === "yes"
                  ? "https://chromewebstore.google.com/detail/ambra-epub-reader/mcjkkebkhifgkkbahlcapjlnaihocogj/reviews"
                  : "mailto:AmbraEPUB@outlook.com"}
                target="_blank" rel="noreferrer"
                style={{ maxWidth: "100%", whiteSpace: "normal" }} onClick={() => setVisible(false)}>
                {t(stage === "yes" ? "review.write" : "review.feedback")}
              </Button>
            </div>
          </>}
          {errorMessage}
        </div>
      </CenteredDialog>
      {!visible && errorMessage}
      <details lang="en" data-prototype-controls="" style={{ marginTop: 16, fontSize: 12, color: "var(--colorNeutralForeground2)" }}>
        <summary>Local prototype controls</summary>
        <p>Review invitation: three reading days and at least halfway through a book. Yes or Not really stops reminders;
          Not sure yet, Escape, or closing postpones for three days. Full Library only.</p>
        <p>Simulation is temporary and never changes your books, reading history, or saved invitation state.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button size="small" onClick={() => simulate(true)}>Simulate eligible reader</Button>
          <Button size="small" onClick={() => simulate(false)}>Simulate new reader</Button>
          <Button size="small" onClick={() => simulate(true)}>Reset simulated invitation</Button>
          <Button size="small" disabled={!simulation}
            onClick={() => setSimulation(current => current ? { ...current, now: current.now + REVIEW_REMINDER_DELAY } : current)}>
            Simulate 3 days later
          </Button>
          <Button size="small" onClick={() => { setVisible(false); setSimulation(undefined); }}>Use real eligibility</Button>
        </div>
        <p role="status">Mode: {simulation ? "simulated" : "real"}. Real reading days: {state?.days.length ?? 0}/3.
          Halfway reached: {state?.reachedHalf ? "yes" : "no"}. Real reminders stopped: {state?.presented ? "yes" : "no"}.
          {simulation && ` Simulated reminders stopped: ${simulation.state.presented ? "yes" : "no"}.`}</p>
      </details>
    </div>
  );
};
