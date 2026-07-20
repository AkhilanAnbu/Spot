import { useState } from "react";
import PropTypes from "prop-types";
import { Link, useNavigate } from "react-router-dom";
import "./NavBar.css";

function NavBar({ currentUser, loading, onLogout }) {
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState("");

  async function handleLogoutClick() {
    setLogoutError("");
    const loggedOut = await onLogout();
    if (loggedOut) {
      navigate("/login");
      return;
    }
    setLogoutError("Could not log out. Please try again.");
  }

  if (loading) {
    return null;
  }

  return (
    <nav className="navbar" aria-label="Primary navigation">
      <Link to="/" className="navbar-brand">
        Spot
      </Link>

      <div className="navbar-links">
        {currentUser ? (
          <>
            <span className="navbar-user">
              Hi, {currentUser.displayName} (@{currentUser.username})
            </span>
            <span className="navbar-separator" aria-hidden="true">
              |
            </span>
            <Link to="/profile">Profile</Link>
            <Link to="/">Dashboard</Link>
            <Link to="/search">Make a Pact</Link>
            <Link to="/log">Log Workout</Link>
            <Link to="/history">History</Link>
            <Link to="/challenges">Challenges</Link>
            <button type="button" onClick={handleLogoutClick}>
              Logout
            </button>
            {logoutError && (
              <span className="navbar-error" role="alert">
                {logoutError}
              </span>
            )}
          </>
        ) : (
          <>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </div>
    </nav>
  );
}

NavBar.propTypes = {
  currentUser: PropTypes.shape({
    username: PropTypes.string,
    displayName: PropTypes.string,
  }),
  loading: PropTypes.bool.isRequired,
  onLogout: PropTypes.func.isRequired,
};

export default NavBar;
