import { useLocation, useNavigate } from "react-router-dom";
import "./css/notFound.css";

export default function NotFoundPage() {
  const navigate = useNavigate();
  const loc = useLocation();
  const rawPath = `${loc.pathname}${loc.search || ""}${loc.hash || ""}`;
  const path = (() => {
    try {

      return decodeURI(rawPath);
    } catch {
      return rawPath;
    }
  })();

  return (
    <div className="nf-wrapper">
      <div className="nf-card">
        <div className="nf-code">404</div>

        <h1 className="nf-title">
          Bu kare boş.
        </h1>

        <p className="nf-description">
          Aradığın sayfa bulunamadı. Belki yanlış hamle yaptın?
        </p>

        <div className="nf-path" title={path}>
          {path}
        </div>

        <div className="nf-actions">
          <button
            className="nf-btn nf-btn-primary"
            onClick={() => navigate("/")}
          >
            Ana Sayfaya Dön
          </button>

          <button
            className="nf-btn nf-btn-secondary"
            onClick={() => navigate(-1)}
          >
            Geri Git
          </button>
        </div>
      </div>
    </div>
  );
}
