import "./css/Footer.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <span className="footer__logo" aria-hidden="true">
            ♞
          </span>
          <span className="footer__name">reChess</span>
        </div>

        <div className="footer__meta">
          <span>© {year} reChess</span>
          <span className="footer__dot" aria-hidden="true">•</span>
          <span>All rights reserved</span>
        </div>
      </div>
    </footer>
  );
}

