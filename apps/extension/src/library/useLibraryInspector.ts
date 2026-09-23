import { useCallback, useEffect, useState } from "react";
import type { EpubInspectionSession } from "../reader/EpubInspectionSession.js";
import type { EpubInspectionData } from "../reader/ReaderTypes.js";

interface InspectionRequest {
  bookId: string;
}

interface InspectionResult {
  request: InspectionRequest;
  session?: EpubInspectionSession;
  data?: EpubInspectionData;
  error?: string;
}

/** Owns pending and active standalone sessions, not just the inspector's visibility. */
export function useLibraryInspector(
  selectedBookId: string | undefined,
  openSession: (bookId: string) => Promise<EpubInspectionSession>,
) {
  const [request, setRequest] = useState<InspectionRequest>();
  const [result, setResult] = useState<InspectionResult>();
  const close = useCallback(() => {
    setRequest(undefined);
    setResult(undefined);
  }, []);

  useEffect(() => { close(); }, [selectedBookId, close]);

  useEffect(() => {
    if (!request || request.bookId !== selectedBookId) return;
    let cancelled = false;
    let ownedSession: EpubInspectionSession | undefined;
    void openSession(request.bookId).then((session) => {
      if (cancelled) {
        session.dispose();
        return;
      }
      ownedSession = session;
      setResult({ request, session, data: session.getEpubInspectionData() });
    }).catch((error: unknown) => {
      ownedSession?.dispose();
      ownedSession = undefined;
      if (!cancelled) {
        setResult({ request, error: error instanceof Error ? error.message : String(error) });
      }
    });
    return () => {
      cancelled = true;
      ownedSession?.dispose();
      ownedSession = undefined;
    };
  }, [request, selectedBookId, openSession]);

  const current = request?.bookId === selectedBookId && result?.request === request ? result : undefined;
  return {
    open: () => {
      if (selectedBookId) setRequest({ bookId: selectedBookId });
    },
    close,
    isOpen: !!request && request.bookId === selectedBookId && !current?.error,
    session: current?.session,
    data: current?.data,
    error: current?.error,
  };
}
