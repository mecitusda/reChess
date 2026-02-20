const SCALE = 173.7178; 

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function toMu(rating) {
  return (rating - 1500) / SCALE;
}

function toPhi(rd) {
  return rd / SCALE;
}

function toRating(mu) {
  return mu * SCALE + 1500;
}

function toRd(phi) {
  return phi * SCALE;
}

function fFactory({ delta, phi, v, a, tau }) {
  return (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
}

function solveSigma({ phi, sigma, delta, v, tau }) {
  const a = Math.log(sigma * sigma);
  const f = fFactory({ delta, phi, v, a, tau });

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  const EPS = 1e-6;
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

export function update1v1({
  playerA,
  playerB,
  scoreA,
  tau = 0.5,
}) {
  const a = {
    r: Number(playerA.rating),
    rd: Number(playerA.rd),
    sigma: Number(playerA.vol),
  };
  const b = {
    r: Number(playerB.rating),
    rd: Number(playerB.rd),
    sigma: Number(playerB.vol),
  };

 
  const mu = toMu(a.r);
  const phi = toPhi(a.rd);
  const muJ = toMu(b.r);
  const phiJ = toPhi(b.rd);

  const gPhiJ = g(phiJ);
  const e = E(mu, muJ, phiJ);

  const v = 1 / (gPhiJ * gPhiJ * e * (1 - e));
  const delta = v * gPhiJ * (scoreA - e);

  const sigmaPrime = solveSigma({ phi, sigma: a.sigma, delta, v, tau });

  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * gPhiJ * (scoreA - e);

  const nextA = {
    rating: toRating(muPrime),
    rd: Math.max(30, toRd(phiPrime)), 
    vol: sigmaPrime,
  };

  
  const scoreB = 1 - scoreA;
  const muB = toMu(b.r);
  const phiB = toPhi(b.rd);
  const muA = toMu(a.r);
  const phiA = toPhi(a.rd);
  const gPhiA = g(phiA);
  const eB = E(muB, muA, phiA);
  const vB = 1 / (gPhiA * gPhiA * eB * (1 - eB));
  const deltaB = vB * gPhiA * (scoreB - eB);
  const sigmaPrimeB = solveSigma({ phi: phiB, sigma: b.sigma, delta: deltaB, v: vB, tau });
  const phiStarB = Math.sqrt(phiB * phiB + sigmaPrimeB * sigmaPrimeB);
  const phiPrimeB = 1 / Math.sqrt(1 / (phiStarB * phiStarB) + 1 / vB);
  const muPrimeB = muB + phiPrimeB * phiPrimeB * gPhiA * (scoreB - eB);

  const nextB = {
    rating: toRating(muPrimeB),
    rd: Math.max(30, toRd(phiPrimeB)),
    vol: sigmaPrimeB,
  };

  return { nextA, nextB };
}

export function initialRatingState() {
  return { rating: 1500, rd: 1000, vol: 0.06 };
}

