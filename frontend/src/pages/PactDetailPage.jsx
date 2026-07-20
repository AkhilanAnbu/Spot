import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useParams, useNavigate, Link } from "react-router-dom";
import "./PactDetailPage.css";

function PactDetailPage({ currentUser }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pact, setPact] = useState(null);
  const [weeklyTarget, setWeeklyTarget] = useState(1);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  async function readError(res, fallback) {
    const data = await res.json().catch(() => ({}));
    return data.error || fallback;
  }

  const loadPact = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(`/api/pacts/${id}`);
      if (!res.ok) {
        setLoadError(await readError(res, "Could not load this pact"));
        return;
      }

      const data = await res.json();
      setPact(data);
      setWeeklyTarget(data.weeklyTarget);
    } catch {
      setLoadError("Could not connect to the server");
    }
  }, [id]);

  useEffect(() => {
    loadPact();
  }, [loadPact]);

  async function handleSaveTarget(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`/api/pacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyTarget: Number(weeklyTarget) }),
      });

      if (!res.ok) {
        setError(await readError(res, "Could not update the weekly target"));
        return;
      }
      navigate("/");
    } catch {
      setError("Could not connect to the server");
    }
  }

  async function handleDissolve() {
    const confirmed = window.confirm(
      "Dissolve this active pact? The shared streak will no longer be available.",
    );
    if (!confirmed) return;

    setError("");
    try {
      const res = await fetch(`/api/pacts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await readError(res, "Could not dissolve pact"));
        return;
      }
      navigate("/");
    } catch {
      setError("Could not connect to the server");
    }
  }

  if (loadError) {
    return (
      <div className="pact-detail-page">
        <p className="pact-detail-error">{loadError}</p>
        <Link to="/">Back to dashboard</Link>
      </div>
    );
  }

  if (!pact) {
    return <p>Loading pact...</p>;
  }

  const iAmPartnerA = pact.partnerA._id === currentUser._id;
  const partner = iAmPartnerA ? pact.partnerB : pact.partnerA;
  const canEdit = pact.status === "pending" && pact.role === "proposer";

  return (
    <div className="pact-detail-page">
      <Link to="/">← Back to dashboard</Link>

      <div className="pact-detail-card">
        <div className="pact-detail-header">
          <h1>
            You &amp; {partner.displayName} (@{partner.username})
          </h1>
          <span className={`pact-status status-${pact.status}`}>
            {pact.status}
          </span>
        </div>

        <div className="stat-tiles">
          <div className="stat-tile stat-tile-target">
            {canEdit ? (
              <form onSubmit={handleSaveTarget}>
                <select
                  id="weeklyTarget"
                  name="weeklyTarget"
                  aria-label="Weekly workout target"
                  value={weeklyTarget}
                  onChange={(e) => setWeeklyTarget(e.target.value)}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button type="submit">Save</button>
              </form>
            ) : (
              <span className="stat-number">{pact.weeklyTarget}</span>
            )}
            <span className="stat-label">Weekly target</span>
          </div>

          {pact.status === "active" && (
            <>
              <div className="stat-tile">
                <span className="stat-number">🔥 {pact.currentStreak}</span>
                <span className="stat-label">Current streak (weeks)</span>
              </div>

              <div className="stat-tile stat-tile-week">
                <span className="stat-week-line">
                  You{" "}
                  <b>
                    {iAmPartnerA
                      ? pact.thisWeek.partnerA
                      : pact.thisWeek.partnerB}
                  </b>{" "}
                  / {pact.thisWeek.target}
                </span>
                <span className="stat-week-line">
                  {partner.displayName}{" "}
                  <b>
                    {iAmPartnerA
                      ? pact.thisWeek.partnerB
                      : pact.thisWeek.partnerA}
                  </b>{" "}
                  / {pact.thisWeek.target}
                </span>
                <span className="stat-label">This week</span>
              </div>
            </>
          )}
        </div>

        {pact.status === "pending" && pact.role === "proposer" && (
          <p className="pact-note">Waiting to be accepted</p>
        )}

        {pact.status === "active" && (
          <button
            type="button"
            className="pact-dissolve-button"
            onClick={handleDissolve}
          >
            Dissolve pact
          </button>
        )}

        {error && <p className="pact-detail-error">{error}</p>}

        <p className="pact-detail-footer">
          {pact.partnerA.displayName} ({pact.partnerA.email}) ·{" "}
          {pact.partnerB.displayName} ({pact.partnerB.email})
        </p>
      </div>
    </div>
  );
}

PactDetailPage.propTypes = {
  currentUser: PropTypes.shape({
    _id: PropTypes.string.isRequired,
  }).isRequired,
};

export default PactDetailPage;
