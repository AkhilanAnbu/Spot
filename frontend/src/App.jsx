import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import PartnerSearchPage from "./pages/PartnerSearchPage";
import ProfilePage from "./pages/ProfilePage";
import PactDetailPage from "./pages/PactDetailPage";
import LogWorkoutPage from "./pages/LogWorkoutPage";
import HistoryPage from "./pages/HistoryPage";
import ChallengesPage from "./pages/ChallengesPage";

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  // check if there is a logged in session yet: used by Navbar, protectedroute and implicity to every ro
  const [loading, setLoading] = useState(true);

  // On first load, ask the server whether a login session already exists.
  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const user = await res.json();
          setCurrentUser(user);
        }
      } catch {
        // A network failure means the session could not be verified. Protected
        // routes will show the login screen instead of leaving the app loading.
        setCurrentUser(null);
      } finally {
        setLoading(false);
      }
    }

    loadCurrentUser();
  }, []);

  // Return a success flag so the navbar only redirects after the server has
  // actually destroyed the session.
  async function handleLogout() {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) return false;
      setCurrentUser(null);
      return true;
    } catch {
      return false;
    }
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          // wrap all the pages in the Layout component so the nav bar is always visible
          element={
            <Layout
              currentUser={currentUser}
              loading={loading}
              onLogout={handleLogout}
            />
          }
        >
          <Route
            path="/login"
            element={<LoginPage onLogin={setCurrentUser} />}
          />
          <Route
            path="/register"
            element={<RegisterPage onRegister={setCurrentUser} />}
          />
          <Route
            path="/"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <PartnerSearchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <ProfilePage
                  currentUser={currentUser}
                  onUserChange={setCurrentUser}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pacts/:id"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <PactDetailPage currentUser={currentUser} />
              </ProtectedRoute>
            }
          />
          <Route
            path="/log"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <LogWorkoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/challenges"
            element={
              <ProtectedRoute currentUser={currentUser} loading={loading}>
                <ChallengesPage currentUser={currentUser} />
              </ProtectedRoute>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
