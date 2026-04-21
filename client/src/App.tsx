import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useBeatsStore } from "@/store/useBeatsStore";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Toaster } from "@/components/ui/Toaster";
import StudioRoute from "@/routes/Studio";
import GalleryRoute from "@/routes/Gallery";
import ProfileRoute from "@/routes/Profile";
import AdminRoute from "@/routes/Admin";
import NotFoundRoute from "@/routes/NotFound";

export default function App() {
  const bootAuth = useBeatsStore((s) => s.bootAuth);

  useEffect(() => bootAuth(), [bootAuth]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<StudioRoute />} />
            <Route path="studio/:projectId" element={<StudioRoute />} />
            <Route path="gallery" element={<GalleryRoute />} />
            <Route path="profile" element={<ProfileRoute />} />
            <Route path="profile/:uid" element={<ProfileRoute />} />
            <Route path="admin" element={<AdminRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </ErrorBoundary>
  );
}
