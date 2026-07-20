import { useState } from "react";
import PropTypes from "prop-types";
import "./ChallengeCard.css";

function todayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ChallengeCard({ challenge, currentUser, onChanged }) {
  const today = todayString();
  const [dayToLog, setDayToLog] = useState(today);
  const [error, setError] = useState("");

  const isCreator = challenge.creatorId === currentUser._id;
  const acceptance = challenge.myAcceptance;
  const isAccepter = Boolean(acceptance);
  const status = acceptance ? acceptance.status : "open";
  const doneCount = acceptance ? acceptance.completedDays.length : 0;
  const dayAlreadyMarked =
    acceptance && acceptance.completedDays.includes(dayToLog);
  const challengeHasStarted = today >= challenge.startDate;
  const latestLoggableDay =
    challenge.endDate < today ? challenge.endDate : today;

  async function readError(res, fallback) {
    const data = await res.json().catch(() => ({}));
    return data.error || fallback;
  }

  async function handleAccept() {
    setError("");
    const res = await fetch(`/api/challenges/${challenge._id}/accept`, {
      method: "PUT",
    });
    if (!res.ok) {
      setError(await readError(res, "Could not accept challenge"));
      return;
    }
    onChanged();
  }

  async function handleMarkDay(e) {
    e.preventDefault();
    setError("");
    const res = await fetch(`/api/challenges/${challenge._id}/day`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dayToLog }),
    });
    if (!res.ok) {
      setError(await readError(res, "Could not log day"));
      return;
    }
    onChanged();
  }

  async function handleDelete() {
    const confirmed = window.confirm("Delete this challenge?");
    if (!confirmed) return;

    setError("");
    const res = await fetch(`/api/challenges/${challenge._id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError(await readError(res, "Could not delete challenge"));
      return;
    }
    onChanged();
  }

  return (
    <div className="challenge-card">
      <div className="challenge-card-header">
        <strong>{challenge.description}</strong>
        {isCreator && <span className="challenge-role">Posted by you</span>}
        <span className={`challenge-status status-${status}`}>{status}</span>
      </div>

      {challenge.creator && (
        <p className="challenge-creator">
          by {challenge.creator.displayName} (@{challenge.creator.username})
        </p>
      )}

      <p className="challenge-window">
        {challenge.startDate} → {challenge.endDate}
      </p>
      <p className="challenge-target">
        Goal: complete on {challenge.targetDays} day
        {challenge.targetDays === 1 ? "" : "s"}
        {isAccepter && ` — ${doneCount} / ${challenge.targetDays} done`}
      </p>

      {!isAccepter && !isCreator && (
        <button type="button" onClick={handleAccept}>
          Accept challenge
        </button>
      )}
      {!isAccepter && isCreator && (
        <p className="challenge-note">Open for others to accept</p>
      )}

      {isAccepter && status === "accepted" && !challengeHasStarted && (
        <p className="challenge-note">
          This challenge starts on {challenge.startDate}.
        </p>
      )}

      {isAccepter && status === "accepted" && challengeHasStarted && (
        <form className="proof-form" onSubmit={handleMarkDay}>
          <label htmlFor={`dayToLog-${challenge._id}`}>Mark a day done</label>
          <input
            id={`dayToLog-${challenge._id}`}
            type="date"
            min={challenge.startDate}
            max={latestLoggableDay}
            value={dayToLog}
            onChange={(e) => setDayToLog(e.target.value)}
            required
          />
          <button type="submit">
            {dayAlreadyMarked ? "Unmark this day" : "Mark this day done"}
          </button>
        </form>
      )}

      {isAccepter && acceptance.completedDays.length > 0 && (
        <ul className="proof-list">
          {acceptance.completedDays.map((date) => (
            <li key={date}>{date}: ✓</li>
          ))}
        </ul>
      )}

      {error && <p className="challenge-card-error">{error}</p>}

      {isCreator && (
        <button
          type="button"
          className="challenge-delete"
          onClick={handleDelete}
        >
          Delete
        </button>
      )}
    </div>
  );
}

ChallengeCard.propTypes = {
  challenge: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    creatorId: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    startDate: PropTypes.string.isRequired,
    endDate: PropTypes.string.isRequired,
    targetDays: PropTypes.number.isRequired,
    creator: PropTypes.shape({
      username: PropTypes.string,
      displayName: PropTypes.string,
    }),
    myAcceptance: PropTypes.shape({
      status: PropTypes.string.isRequired,
      completedDays: PropTypes.arrayOf(PropTypes.string).isRequired,
    }),
  }).isRequired,
  currentUser: PropTypes.shape({
    _id: PropTypes.string.isRequired,
  }).isRequired,
  onChanged: PropTypes.func.isRequired,
};

export default ChallengeCard;
