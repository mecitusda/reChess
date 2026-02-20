import { Outlet } from "react-router-dom";
import Header from "../header";
import Footer from "../Footer";
export default function MainLayout() {
  return (
    <>
      <Header />

      <main>
        <Outlet />
      </main>

      <Footer />
    </>
  );
}
