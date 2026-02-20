import { BrowserRouter, Routes, Route } from "react-router-dom";
import LobbyPage from "../pages/LobbyPage";
import GamePage from "../pages/GamePage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";
import GamesPage from "../pages/GamesPage";
import ProfilePage from "../pages/ProfilePage";
import NotFoundPage from "../pages/NotFoundPage";
import MainLayout from "../components/Layout/MainLayout";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/u/:username" element={<ProfilePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/game/:gameId" element={<GamePage />} />
        <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
