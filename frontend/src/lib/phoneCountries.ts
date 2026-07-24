import { getCountries, getCountryCallingCode, type CountryCode } from "libphonenumber-js"

let countryNamer: Intl.DisplayNames | null | undefined

export function countryName(iso: CountryCode): string {
  try {
    if (countryNamer === undefined) {
      countryNamer =
        typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null
    }
    return countryNamer?.of(iso) || iso
  } catch {
    return iso
  }
}

export function flagEmoji(iso: string): string {
  if (!iso || iso.length !== 2) return ""
  const base = 127397 // regional-indicator offset from the ASCII letter codepoint
  return String.fromCodePoint(iso.charCodeAt(0) + base, iso.charCodeAt(1) + base)
}

export const PHONE_COUNTRIES = getCountries()
  .map((iso) => ({ iso, name: countryName(iso), dial: getCountryCallingCode(iso) }))
  .sort((a, b) => a.name.localeCompare(b.name))
