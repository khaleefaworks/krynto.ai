import { useState } from "react"
import {
  getCountries,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Matches the backend's DEFAULT_PHONE_REGION (backend/app/repos/forms.py)
// and the widget's DEFAULT_PHONE_COUNTRY — bare digits with no country
// context are assumed Indian everywhere else in this app, so this field
// stays consistent with that assumption for a phone that hasn't been set
// yet, or one stored as legacy bare digits.
const DEFAULT_COUNTRY: CountryCode = "IN"

let countryNamer: Intl.DisplayNames | null | undefined
function countryName(iso: CountryCode): string {
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

function flagEmoji(iso: string): string {
  if (!iso || iso.length !== 2) return ""
  const base = 127397 // regional-indicator offset from the ASCII letter codepoint
  return String.fromCodePoint(iso.charCodeAt(0) + base, iso.charCodeAt(1) + base)
}

const COUNTRIES = getCountries()
  .map((iso) => ({ iso, name: countryName(iso), dial: getCountryCallingCode(iso) }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Splits a stored value — either legacy bare digits or an E.164
// "+<code><digits>" string — into (country, national digits) for the two
// controls below. Mirrors the widget's enhancePhoneField prefill logic
// (chat-widget.js) so a number saved by one surface displays consistently
// on the other.
function splitValue(value: string): { country: CountryCode; digits: string } {
  const trimmed = (value || "").trim()
  if (trimmed.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(trimmed)
    if (parsed) return { country: (parsed.country as CountryCode) || DEFAULT_COUNTRY, digits: parsed.nationalNumber }
  }
  return { country: DEFAULT_COUNTRY, digits: trimmed.replace(/\D/g, "") }
}

interface PhoneNumberFieldProps {
  value: string
  onChange: (value: string) => void
  required?: boolean
  className?: string
}

// Country-code select + national-number input, backed by libphonenumber-js
// — the dashboard counterpart to the widget's phone field (chat-widget.js's
// enhancePhoneField/_buildPhoneCountrySelect), used wherever an agent edits
// a visitor's phone number after the fact. Deliberately a plain native
// <select> rather than the widget's full searchable combobox: this only
// ever runs inside an already-open modal in the agent dashboard, where a
// ~240-option native select (browsable by typing) is a reasonable tradeoff
// against reimplementing that whole custom listbox.
export default function PhoneNumberField({ value, onChange, required, className }: PhoneNumberFieldProps) {
  const [{ country, digits }, setState] = useState(() => splitValue(value))

  const emit = (nextCountry: CountryCode, nextDigits: string) => {
    if (!nextDigits) {
      onChange("")
      return
    }
    const parsed = parsePhoneNumberFromString(nextDigits, nextCountry)
    onChange(parsed ? parsed.number : `+${getCountryCallingCode(nextCountry)}${nextDigits}`)
  }

  const isValid = !digits || isValidPhoneNumber(digits, country)

  return (
    <div className={className}>
      <div className="flex gap-1.5">
        <select
          value={country}
          onChange={(e) => {
            const nextCountry = e.target.value as CountryCode
            setState({ country: nextCountry, digits })
            emit(nextCountry, digits)
          }}
          className="h-10 flex-shrink-0 w-[100px] rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso} value={c.iso}>
              {flagEmoji(c.iso)} +{c.dial}
            </option>
          ))}
        </select>
        <Input
          value={digits}
          placeholder={required ? "Phone number *" : "Phone number"}
          onChange={(e) => {
            const nextDigits = e.target.value.replace(/\D/g, "").slice(0, 15)
            setState({ country, digits: nextDigits })
            emit(country, nextDigits)
          }}
          className={cn("text-sm", !isValid && "border-red-500 focus-visible:ring-red-500")}
        />
      </div>
      {!isValid && <p className="text-xs text-red-500 mt-1">Please enter a valid phone number.</p>}
    </div>
  )
}
