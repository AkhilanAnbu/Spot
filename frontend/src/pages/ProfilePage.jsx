import { useState } from "react";
import PropTypes from "prop-types";
import { useNavigate } from "react-router-dom";
import ProfileForm from "../components/ProfileForm";
import { memberSince } from "../lib/formatDate";
import "./ProfilePage.css";

function ProfilePage({ currentUser, onUserChange }) {
  const navigate = useNavigate();
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      "Are you sure you want to delete your account? This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleteError("");
    setDeleting(true);

    try {
      const res = await fetch(`/api/users/${currentUser._id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || "Could not delete account");
        return;
      }

      onUserChange(null);
      navigate("/login");
    } catch {
      setDeleteError("Could not connect to the server");
    } finally {
      setDeleting(false);
    }
  }

  if (!currentUser) {
    return <p>Loading profile...</p>;
  }

  return (
    <div className="profile-page">
      <h1>Profile</h1>

      <p className="profile-username">@{currentUser.username}</p>

      {currentUser.createdAt && (
        <p className="profile-since">
          Member since {memberSince(currentUser.createdAt)}
        </p>
      )}

      <ProfileForm user={currentUser} onSave={onUserChange} />

      {deleteError && (
        <p className="profile-delete-error" role="alert">
          {deleteError}
        </p>
      )}

      <button
        type="button"
        className="delete-account-button"
        onClick={handleDeleteAccount}
        disabled={deleting}
      >
        {deleting ? "Deleting..." : "Delete account"}
      </button>
    </div>
  );
}

ProfilePage.propTypes = {
  currentUser: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    username: PropTypes.string.isRequired,
    displayName: PropTypes.string.isRequired,
    email: PropTypes.string.isRequired,
    createdAt: PropTypes.string,
  }),
  onUserChange: PropTypes.func.isRequired,
};

export default ProfilePage;
