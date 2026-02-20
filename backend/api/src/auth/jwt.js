import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

export function signToken(payload, opts = {}) {
  return jwt.sign(payload, SECRET, { expiresIn: "30d", ...opts });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

