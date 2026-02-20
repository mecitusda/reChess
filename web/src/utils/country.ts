export function countryFlag(code: string | undefined | null) {
    if (!code || code.length !== 2) return "🏳️";
  
    return code
      .toUpperCase()
      .replace(/./g, char =>
        String.fromCodePoint(127397 + char.charCodeAt(0))
      );
  }
  