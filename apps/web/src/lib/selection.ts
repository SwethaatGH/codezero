import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useUI } from "./store";

/**
 * The selected investigation and commit live in the URL (?inv=…&commit=…&a=…&b=…), so every module
 * stays in sync, deep links work, and browser back/forward restore context.
 */
export function useSelection() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lastInv = useUI((s) => s.lastInvestigationId);
  const setLast = useUI((s) => s.setLastInvestigation);

  const invId = params.get("inv") ?? lastInv;
  const commitSha = params.get("commit");
  const compareA = params.get("a");
  const compareB = params.get("b");

  useEffect(() => {
    if (params.get("inv") && params.get("inv") !== lastInv) setLast(params.get("inv"));
  }, [params, lastInv, setLast]);

  const update = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      const next = new URLSearchParams(params);
      if (!next.get("inv") && invId) next.set("inv", invId);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      setParams(next, { replace });
    },
    [params, setParams, invId],
  );

  const go = useCallback(
    (path: string, patch: Record<string, string | null> = {}) => {
      const next = new URLSearchParams();
      const inv = patch.inv !== undefined ? patch.inv : invId;
      if (inv) next.set("inv", inv);
      for (const k of ["commit", "a", "b"]) {
        const v = patch[k] !== undefined ? patch[k] : params.get(k);
        if (v) next.set(k, v);
      }
      navigate(`${path}?${next.toString()}`);
    },
    [navigate, params, invId],
  );

  return {
    invId,
    commitSha,
    compareA,
    compareB,
    pathname: location.pathname,
    setInvestigation: (id: string | null) => {
      setLast(id);
      update({ inv: id, commit: null, a: null, b: null });
    },
    selectCommit: (sha: string | null) => update({ commit: sha }, true),
    setCompare: (a: string | null, b: string | null) => update({ a, b }),
    go,
  };
}
